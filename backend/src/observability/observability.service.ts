import { createHash, randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Prisma } from '../../generated/prisma';
import { PrismaService } from '../prisma.service';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';
import { createPlaceResolver, lookUpLocalPlace, type Area, type Place } from './region';
import { categoryOf, clientOf, hongKongDay, observed, queryOperation, sourceOf, telemetry, type Client, type TelemetrySource } from './telemetry';

/** How often each instance adds its counts to the database and writes its live state. */
export const FLUSH_MS = 15_000;
/** 在線: a signed-in driver or a passenger page that made a request in the last 5 minutes. */
export const PRESENCE_WINDOW_MS = 5 * 60_000;
/** Instances that have not written for this long have stopped. */
const INSTANCE_FRESH_MS = 45_000;
const SLOW_MS = 800;
const KEEP_DAYS = 30;
const CLEANUP_MS = 60 * 60_000;

/** 通知 streams one API instance can hold before other requests wait (Cloud Run's 80 per instance). */
const STREAMS_PER_INSTANCE = 80;

interface Counter {
  day: Date;
  region: string;
  area: Area;
  source: TelemetrySource;
  client: Client;
  category: 'application' | 'health';
  count: number;
  errors: number;
  clientErrors: number;
  slow: number;
  totalMs: number;
}

/** Someone active in the last 5 minutes: a signed-in driver by id, a passenger page by an unstored hash. */
interface Activity {
  kind: 'driver' | 'passenger';
  userId?: string;
  client: Client;
  region: string;
  lastActivityAt: number;
}

/** An open 通知 stream: a driver with the app open. */
interface Connection {
  userId: string;
  client: Client;
  region: string;
  connectedAt: number;
}

interface PresenceState {
  activity: Activity[];
  connections: Connection[];
}

type AuthedRequest = Request & { user?: { id: string } };

/**
 * 數據流監控 on this API instance: every finished request is counted by day, region, part of
 * MasterDriver and browser, and told to watching admin pages; who is active is kept for five
 * minutes. Counts and live state go to the database every 15 seconds so the page adds up every
 * instance. Nothing here may slow down or fail a request.
 */
@Injectable()
export class ObservabilityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ObservabilityService.name);
  readonly instanceId = randomUUID();
  private readonly startedAt = new Date();
  private counters = new Map<string, Counter>();
  private readonly activity = new Map<string, Activity>();
  private readonly connections = new Map<symbol, Connection>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastCleanup = 0;
  private readonly failureLogged = new Map<string, number>();
  /** The last write of counts to the database, as the page shows it. */
  write: { status: 'pending' | 'ok' | 'error'; at: string | null } = { status: 'pending', at: null };

  private readonly resolvePlace = createPlaceResolver(lookUpLocalPlace, (error) =>
    this.warnOnce(error instanceof Error && error.message.includes('ENOENT') ? 'GeoIP database missing' : 'GeoIP lookup failed'),
  );

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush(), FLUSH_MS);
    this.timer.unref?.();
    PrismaService.onQuery = (sql, durationMs) => {
      if (!telemetry.watched) return;
      const operation = queryOperation(sql);
      if (operation) telemetry.emit({ type: 'data:end', source: 'data', operation, status: 'success', durationMs });
    };
  }

  async onModuleDestroy() {
    clearInterval(this.timer);
    PrismaService.onQuery = undefined;
    await this.flush();
    await this.prisma.observabilityInstance.deleteMany({ where: { id: this.instanceId } }).catch(() => undefined);
  }

  // ------------------------------------------------------------- recording

  /** Express middleware: counts each request when its answer has gone out. */
  readonly middleware = (request: Request, response: Response, next: NextFunction) => {
    const startedAt = Date.now();
    response.on('finish', () => {
      void this.recordRequest(request as AuthedRequest, response.statusCode, Date.now() - startedAt).catch((error) =>
        this.warnOnce(`Request not counted: ${(error as Error).message}`),
      );
    });
    next();
  };

  private async recordRequest(request: AuthedRequest, httpStatus: number, durationMs: number, now = new Date()) {
    // The route as written, so a passenger's own link (/c/{code}) never reaches the monitor.
    const route = (request.route as { path?: unknown } | undefined)?.path;
    const path = typeof route === 'string' ? route : '(沒有對應的路徑)';
    if (!observed(path)) return;
    const place = await this.resolvePlace(request.ip);
    const client = clientOf(request.headers['user-agent']);
    const source = sourceOf(path);
    const category = categoryOf(path);
    this.count({ day: hongKongDay(now), region: place.region, area: place.area, source, client, category }, httpStatus, durationMs);
    if (category === 'application') this.noteActivity(request, source, client, place, now.getTime());
    if (category === 'health') return;
    telemetry.emit({
      type: 'request:end',
      source,
      category,
      method: request.method,
      path,
      status: httpStatus >= 400 ? 'error' : 'success',
      httpStatus,
      durationMs,
      region: place.region,
      client,
    });
  }

  private count(key: Omit<Counter, 'count' | 'errors' | 'clientErrors' | 'slow' | 'totalMs'>, httpStatus: number, durationMs: number) {
    const id = [key.day.toISOString(), key.region, key.area, key.source, key.client, key.category].join('|');
    const counter = this.counters.get(id) ?? { ...key, count: 0, errors: 0, clientErrors: 0, slow: 0, totalMs: 0 };
    counter.count += 1;
    if (httpStatus >= 500) counter.errors += 1;
    else if (httpStatus >= 400) counter.clientErrors += 1;
    if (durationMs >= SLOW_MS) counter.slow += 1;
    counter.totalMs += durationMs;
    this.counters.set(id, counter);
  }

  private noteActivity(request: AuthedRequest, source: TelemetrySource, client: Client, place: Place, at: number) {
    if (source === 'driver' && request.user) {
      this.activity.set(`driver:${request.user.id}`, { kind: 'driver', userId: request.user.id, client, region: place.region, lastActivityAt: at });
    } else if (source === 'passenger') {
      // Kept in memory only, to count one phone once; the address itself is not kept.
      const key = createHash('sha256').update(`${request.ip}|${request.headers['user-agent'] ?? ''}`).digest('hex').slice(0, 16);
      this.activity.set(`passenger:${key}`, { kind: 'passenger', client, region: place.region, lastActivityAt: at });
    }
  }

  /** A driver opened the 通知 stream; returns what to call when it closes. */
  connect(userId: string, request: Request) {
    const id = Symbol(userId);
    const client = clientOf(request.headers['user-agent']);
    this.connections.set(id, { userId, client, region: '未知地區', connectedAt: Date.now() });
    void this.resolvePlace(request.ip).then((place) => {
      const connection = this.connections.get(id);
      if (connection) connection.region = place.region;
    });
    return () => this.connections.delete(id);
  }

  // ---------------------------------------------------------------- writing

  /** Adds this instance's counts to the database and writes its live state. A failed write is retried next time. */
  async flush(now = new Date()) {
    const counters = [...this.counters.values()];
    this.counters = new Map();
    try {
      for (const counter of counters) {
        const { day, region, area, source, client, category } = counter;
        await this.prisma.observabilityRequestStat.upsert({
          where: { day_region_area_source_client_category: { day, region, area, source, client, category } },
          create: { ...counter, totalMs: BigInt(Math.round(counter.totalMs)) },
          update: {
            count: { increment: counter.count },
            errors: { increment: counter.errors },
            clientErrors: { increment: counter.clientErrors },
            slow: { increment: counter.slow },
            totalMs: { increment: BigInt(Math.round(counter.totalMs)) },
          },
        });
      }
      const presence = this.presence(now.getTime());
      await this.prisma.observabilityInstance.upsert({
        where: { id: this.instanceId },
        create: { id: this.instanceId, startedAt: this.startedAt, updatedAt: now, presence: presence as unknown as Prisma.InputJsonValue, streams: presence.connections.length },
        update: { updatedAt: now, presence: presence as unknown as Prisma.InputJsonValue, streams: presence.connections.length },
      });
      if (now.getTime() - this.lastCleanup > CLEANUP_MS) {
        this.lastCleanup = now.getTime();
        await this.prisma.observabilityRequestStat.deleteMany({ where: { day: { lt: new Date(hongKongDay(now).getTime() - KEEP_DAYS * 86_400_000) } } });
        await this.prisma.observabilityInstance.deleteMany({ where: { updatedAt: { lt: new Date(now.getTime() - 10 * 60_000) } } });
      }
      this.write = { status: 'ok', at: now.toISOString() };
    } catch (error) {
      // Put the counts back to add them next time; a counter written already before the failure may count twice.
      this.mergeBack(counters);
      this.write = { status: 'error', at: now.toISOString() };
      this.warnOnce(`Observability write failed: ${(error as Error).message}`);
    }
  }

  private mergeBack(counters: Counter[]) {
    for (const counter of counters) {
      const id = [counter.day.toISOString(), counter.region, counter.area, counter.source, counter.client, counter.category].join('|');
      const current = this.counters.get(id);
      if (!current) {
        this.counters.set(id, counter);
        continue;
      }
      current.count += counter.count;
      current.errors += counter.errors;
      current.clientErrors += counter.clientErrors;
      current.slow += counter.slow;
      current.totalMs += counter.totalMs;
    }
  }

  private presence(now: number): PresenceState {
    for (const [key, entry] of this.activity) if (entry.lastActivityAt + PRESENCE_WINDOW_MS <= now) this.activity.delete(key);
    return { activity: [...this.activity.values()], connections: [...this.connections.values()] };
  }

  // --------------------------------------------------------------- reading

  /** Every instance written in the last 45 seconds, this one included. */
  private async liveInstances(now: Date) {
    const rows = await this.prisma.observabilityInstance.findMany({ where: { updatedAt: { gt: new Date(now.getTime() - INSTANCE_FRESH_MS) } } });
    const states = rows.filter((row) => row.id !== this.instanceId).map((row) => row.presence as unknown as PresenceState);
    return { count: new Set([...rows.map((row) => row.id), this.instanceId]).size, states: [this.presence(now.getTime()), ...states] };
  }

  /**
   * 即時在線用戶, as Master Travel groups it: per part and browser, how many were active in the
   * last 5 minutes and how many have the page open now (a 通知 stream), with their regions.
   * A driver seen on two instances counts once.
   */
  private presenceSummary(states: PresenceState[], now: number) {
    // Passenger pages have no id to match across instances; one seen on two instances counts twice.
    const activity = new Map<string, Activity>();
    let anonymous = 0;
    for (const state of states) {
      for (const entry of state.activity) {
        if (entry.lastActivityAt + PRESENCE_WINDOW_MS <= now) continue;
        const key = entry.userId ? `driver:${entry.userId}` : `passenger:${(anonymous += 1)}`;
        const known = activity.get(key);
        if (!known || known.lastActivityAt < entry.lastActivityAt) activity.set(key, entry);
      }
    }
    const connections = states.flatMap((state) => state.connections);
    const group = (entries: { kind?: string; client: Client; region: string }[]) => {
      const result: Record<string, { count: number; regions: Record<string, number> }> = {};
      for (const entry of entries) {
        const key = `${entry.kind ?? 'driver'}:${entry.client}`;
        const bucket = (result[key] ??= { count: 0, regions: {} });
        bucket.count += 1;
        bucket.regions[entry.region] = (bucket.regions[entry.region] ?? 0) + 1;
      }
      return result;
    };
    return { activity: group([...activity.values()]), connections: group(connections), windowMs: PRESENCE_WINDOW_MS, activityEntries: [...activity.values()], connectionEntries: connections };
  }

  /**
   * Everything the page shows that is not a live event; read again every 15 seconds. This
   * instance's own counts are written first; another instance's are at most 15 seconds behind.
   */
  async snapshot(now = new Date()) {
    await this.flush(now);
    const day = hongKongDay(now);
    // The day's start in real time: 00:00 in Hong Kong is 16:00 UTC the day before.
    const since = new Date(day.getTime() - 8 * 60 * 60 * 1000);
    const [instances, regions, areas, clients, business, sms, services] = await Promise.all([
      this.liveInstances(now),
      this.prisma.observabilityRequestStat.groupBy({ by: ['region', 'source', 'client'], where: { day }, _sum: { count: true } }),
      this.prisma.observabilityRequestStat.groupBy({
        by: ['area'],
        where: { day, category: 'application' },
        _sum: { count: true, errors: true, clientErrors: true, slow: true, totalMs: true },
      }),
      this.prisma.observabilityRequestStat.groupBy({ by: ['client', 'source'], where: { day, category: 'application' }, _sum: { count: true } }),
      this.business(since),
      this.sms(since),
      this.services(),
    ]);
    const presence = this.presenceSummary(instances.states, now.getTime());
    const streams = presence.connectionEntries.length;
    return {
      type: 'snapshot' as const,
      day: day.toISOString().slice(0, 10),
      checkedAt: now.toISOString(),
      instances: instances.count,
      write: this.write,
      presence: { activity: presence.activity, connections: presence.connections, windowMs: presence.windowMs },
      regions: regions.map((row) => ({ region: row.region, source: row.source, client: row.client, count: row._sum.count ?? 0 })),
      areas: areas.map((row) => {
        const count = row._sum.count ?? 0;
        return {
          area: row.area,
          count,
          errors: row._sum.errors ?? 0,
          clientErrors: row._sum.clientErrors ?? 0,
          slow: row._sum.slow ?? 0,
          averageMs: count ? Math.round(Number(row._sum.totalMs ?? 0) / count) : null,
        };
      }),
      clients: clients.map((row) => ({ client: row.client, source: row.source, count: row._sum.count ?? 0 })),
      business,
      sms,
      streams: { open: streams, capacity: instances.count * STREAMS_PER_INSTANCE, perInstance: STREAMS_PER_INSTANCE },
      services,
    };
  }

  /** 業務即時數字 for the day so far, from the records themselves. */
  private async business(since: Date) {
    const [orders, claims, confirmed, completed, cancelled, bookings, users] = await Promise.all([
      this.prisma.order.count({ where: { createdAt: { gte: since } } }),
      this.prisma.orderClaim.groupBy({ by: ['result'], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.order.count({ where: { passengerConfirmedAt: { gte: since } } }),
      this.prisma.order.count({ where: { completedAt: { gte: since } } }),
      this.prisma.order.count({ where: { cancelledAt: { gte: since } } }),
      this.prisma.bookingRequest.count({ where: { createdAt: { gte: since } } }),
      this.prisma.user.count({ where: { createdAt: { gte: since } } }),
    ]);
    const claimed = (result: string) => claims.find((row) => row.result === result)?._count ?? 0;
    return { orders, claimsWon: claimed('WON'), claimsLost: claimed('LOST'), confirmed, completed, cancelled, bookings, users };
  }

  /** 簡訊 sent today per provider and route, and when each last went out. */
  private async sms(since: Date) {
    const [today, lastSent] = await Promise.all([
      this.prisma.smsMessage.groupBy({ by: ['provider', 'route', 'status'], where: { createdAt: { gte: since } }, _count: true }),
      this.prisma.smsMessage.groupBy({ by: ['provider', 'route'], where: { status: 'sent' }, _max: { createdAt: true } }),
    ]);
    return {
      today: today.map((row) => ({ provider: row.provider, route: row.route, status: row.status, count: row._count })),
      lastSent: lastSent.map((row) => ({ provider: row.provider, route: row.route, at: row._max.createdAt?.toISOString() ?? null })),
    };
  }

  /** 外部服務: the database's answer time from here, and whether pictures and videos can be stored. */
  private async services() {
    const started = Date.now();
    let database: { ok: boolean; ms: number | null } = { ok: true, ms: null };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      database = { ok: true, ms: Date.now() - started };
    } catch {
      database = { ok: false, ms: null };
    }
    return { database, storage: { ok: this.storage.available } };
  }

  /** 乘客／司機訪問明細 for the super admin: each signed-in driver active or connected now, with their number. */
  async identities(now = new Date()) {
    const instances = await this.liveInstances(now);
    const presence = this.presenceSummary(instances.states, now.getTime());
    const byUser = new Map<string, { client: Client; region: string; connected: boolean; lastActivityAt: number | null }>();
    for (const entry of presence.activityEntries) {
      if (entry.userId) byUser.set(entry.userId, { client: entry.client, region: entry.region, connected: false, lastActivityAt: entry.lastActivityAt });
    }
    for (const entry of presence.connectionEntries) {
      const known = byUser.get(entry.userId);
      byUser.set(entry.userId, { client: entry.client, region: known?.region ?? entry.region, connected: true, lastActivityAt: known?.lastActivityAt ?? null });
    }
    const users = await this.prisma.user.findMany({
      where: { id: { in: [...byUser.keys()] } },
      select: { id: true, countryCode: true, phone: true, profile: { select: { name: true } } },
    });
    return {
      windowMs: PRESENCE_WINDOW_MS,
      users: users
        .map((user) => {
          const seen = byUser.get(user.id)!;
          return {
            userId: user.id,
            phone: `${user.countryCode} ${user.phone}`,
            name: user.profile?.name ?? null,
            client: seen.client,
            region: seen.region,
            connected: seen.connected,
            lastActivityAt: seen.lastActivityAt ? new Date(seen.lastActivityAt).toISOString() : null,
          };
        })
        .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? '')),
    };
  }

  private warnOnce(message: string) {
    const last = this.failureLogged.get(message) ?? 0;
    if (Date.now() - last < 10 * 60_000) return;
    this.failureLogged.set(message, Date.now());
    this.logger.warn(message);
  }
}
