import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma.service';

/** How often an instance looks for notifications written by another instance. */
const CHECK_MS = 3_000;
/** A comment line now and then keeps proxies from closing a quiet stream. */
const PING_MS = 20_000;
/**
 * Each stream ends after this and the page opens a new one: the web front end's proxy
 * closes a response after 120 seconds, and a fresh request also checks the session again.
 */
export const STREAM_MS = 90_000;
/** Clocks of instances and the database differ a little; look back this far. */
const LOOK_BACK_MS = 5_000;

/**
 * The open notification streams on this instance. A stream carries no content: it only says
 * "something changed" and the page reads the list. A notification written on this instance
 * is told at once; one written on another instance (Cloud Run runs several) is found by one
 * query per check for every user with a stream here, however many streams there are.
 */
@Injectable()
export class NotificationStreams implements OnModuleDestroy {
  private readonly logger = new Logger(NotificationStreams.name);
  private readonly streams = new Map<string, Set<Response>>();
  /** The newest notification time each user's streams were told about. */
  private readonly seen = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private checking = false;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  open(userId: string, response: Response) {
    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Connection', 'keep-alive');
    // nginx in front of the web app must pass each line on as it comes.
    response.setHeader('X-Accel-Buffering', 'no');
    response.flushHeaders();
    response.write('retry: 5000\n\n');

    let set = this.streams.get(userId);
    if (!set) {
      set = new Set();
      this.streams.set(userId, set);
      this.seen.set(userId, Date.now() - LOOK_BACK_MS);
    }
    set.add(response);
    this.start();

    const ping = setInterval(() => response.write(': ping\n\n'), PING_MS);
    const end = setTimeout(() => response.end(), STREAM_MS);
    response.on('close', () => {
      clearInterval(ping);
      clearTimeout(end);
      this.remove(userId, response);
    });
  }

  /**
   * Tells the user's streams on this instance that their notifications changed. `at` is the
   * time of the notification written here, so the next check does not tell the same one again.
   */
  poke(userId: string, at?: Date) {
    const set = this.streams.get(userId);
    if (!set) return;
    if (at) this.seen.set(userId, Math.max(this.seen.get(userId) ?? 0, at.getTime()));
    for (const response of set) response.write('event: changed\ndata: {}\n\n');
  }

  onModuleDestroy() {
    clearInterval(this.timer);
    for (const set of this.streams.values()) for (const response of set) response.end();
    this.streams.clear();
  }

  private remove(userId: string, response: Response) {
    const set = this.streams.get(userId);
    if (!set) return;
    set.delete(response);
    if (set.size === 0) {
      this.streams.delete(userId);
      this.seen.delete(userId);
    }
    if (this.streams.size === 0) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private start() {
    this.timer ??= setInterval(() => void this.check(), CHECK_MS);
  }

  private async check() {
    if (this.checking || this.streams.size === 0) return;
    this.checking = true;
    try {
      const since = new Date(Math.min(...this.seen.values()));
      const rows = await this.prisma.notification.groupBy({
        by: ['userId'],
        where: { userId: { in: [...this.streams.keys()] }, createdAt: { gt: since } },
        _max: { createdAt: true },
      });
      for (const row of rows) {
        const newest = row._max.createdAt?.getTime() ?? 0;
        const seen = this.seen.get(row.userId);
        if (seen === undefined || newest <= seen) continue;
        this.seen.set(row.userId, newest);
        this.poke(row.userId);
      }
    } catch (error) {
      this.logger.warn(`Notification check failed: ${(error as Error).message}`);
    } finally {
      this.checking = false;
    }
  }
}
