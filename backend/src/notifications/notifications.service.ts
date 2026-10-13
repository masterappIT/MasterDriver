import { Inject, Injectable, Logger } from '@nestjs/common';
import { NOTIFICATION_KEEP_DAYS, NOTIFICATION_PAGE_SIZE, type NotificationRead, type NotificationSettings } from '@masterdriver/shared';
import type { NotificationGroup, NotificationKind } from '../../generated/prisma';
import { PrismaService } from '../prisma.service';
import { NotificationStreams } from './notification-streams';

const DAY_MS = 24 * 60 * 60 * 1000;
/** The longest a dispatcher can hold the passenger's phone back (contactReveal in shared/src/schemas.ts). */
const MAX_REVEAL_MS = 1440 * 60_000;

/** The trip a notification is about, as the line shows it. */
export interface TripRef {
  id: string;
  origin: string;
  destination: string;
  pickupAt: Date;
}

export interface NotificationInput {
  userId: string;
  kind: NotificationKind;
  /** Which switch in 通知設定 turns it off. */
  group: NotificationGroup;
  order?: TripRef;
  booking?: TripRef;
  dedupeKey?: string;
}

const tripSelect = { id: true, origin: true, destination: true, pickupAt: true } as const;

/**
 * 通知: lines under the bell about what happened to the user's orders, bookings and 客服
 * conversation. Written after the change itself; a failure here is logged and never undoes
 * or fails what the user did.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationStreams) private readonly streams: NotificationStreams,
  ) {}

  async send(input: NotificationInput, now = new Date()) {
    try {
      const user = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { notificationsOff: true } });
      if (!user || user.notificationsOff.includes(input.group)) return;
      if (input.kind === 'SUPPORT_REPLY') {
        // One line per unread conversation: a reply in several messages moves it to the top again.
        const moved = await this.prisma.notification.updateMany({
          where: { userId: input.userId, kind: 'SUPPORT_REPLY', readAt: null },
          data: { createdAt: now },
        });
        if (moved.count > 0) return this.streams.poke(input.userId, now);
      }
      const trip = input.order ?? input.booking;
      const created = await this.prisma.notification.createMany({
        data: [
          {
            userId: input.userId,
            kind: input.kind,
            orderId: input.order?.id ?? null,
            bookingId: input.booking?.id ?? null,
            summary: trip ? `${trip.origin} 至 ${trip.destination}` : '',
            pickupAt: trip?.pickupAt ?? null,
            dedupeKey: input.dedupeKey ?? null,
            createdAt: now,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count > 0) this.streams.poke(input.userId, now);
    } catch (error) {
      this.logger.warn(`Notification ${input.kind} for ${input.userId} not recorded: ${(error as Error).message}`);
    }
  }

  /** An order's trip as a notification shows it; null when the order is gone. */
  trip(orderId: string) {
    return this.prisma.order.findUnique({ where: { id: orderId }, select: tripSelect });
  }

  async list(userId: string, now = new Date()) {
    await this.revealDue(userId, now);
    await this.prisma.notification.deleteMany({ where: { userId, createdAt: { lt: new Date(now.getTime() - NOTIFICATION_KEEP_DAYS * DAY_MS) } } });
    const [rows, unread] = await Promise.all([
      this.prisma.notification.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: NOTIFICATION_PAGE_SIZE }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    return {
      unread,
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        orderId: row.orderId,
        bookingId: row.bookingId,
        summary: row.summary,
        pickupAt: row.pickupAt?.toISOString() ?? null,
        read: row.readAt !== null,
        createdAt: row.createdAt.toISOString(),
      })),
    };
  }

  async markRead(userId: string, input: NotificationRead, now = new Date()) {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null, ...('id' in input ? { id: input.id } : {}) },
      data: { readAt: now },
    });
    return { unread: await this.prisma.notification.count({ where: { userId, readAt: null } }) };
  }

  /** Opening the 客服 conversation reads its notification too. */
  async supportRead(userId: string, now = new Date()) {
    await this.prisma.notification.updateMany({ where: { userId, kind: 'SUPPORT_REPLY', readAt: null }, data: { readAt: now } });
  }

  async settings(userId: string): Promise<NotificationSettings> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { notificationsOff: true } });
    return { off: user.notificationsOff };
  }

  async saveSettings(userId: string, input: NotificationSettings): Promise<NotificationSettings> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { notificationsOff: [...new Set(input.off)] },
      select: { notificationsOff: true },
    });
    return { off: user.notificationsOff };
  }

  /**
   * 可以看乘客電話了: nothing happens at that moment, so the line is written the next time the
   * driver's notifications are read (on opening the app, every stream, every list). Once per
   * claim: a driver who gets the same order again after 改派 is told again. Not when the phone
   * was shown from the moment of the claim.
   */
  async revealDue(userId: string, now = new Date()) {
    const orders = await this.prisma.order.findMany({
      where: {
        claimedById: userId,
        status: 'ASSIGNED',
        contactRevealMinutes: { not: null },
        dispatcherId: { not: userId },
        pickupAt: { gt: now, lte: new Date(now.getTime() + MAX_REVEAL_MS) },
      },
      select: { ...tripSelect, contactRevealMinutes: true, claimedAt: true },
    });
    for (const order of orders) {
      const revealAt = order.pickupAt.getTime() - (order.contactRevealMinutes ?? 0) * 60_000;
      if (revealAt > now.getTime() || !order.claimedAt || order.claimedAt.getTime() >= revealAt) continue;
      await this.send(
        { userId, kind: 'CONTACT_REVEALED', group: 'CLAIMED', order, dedupeKey: `reveal:${order.id}:${order.claimedAt.getTime()}` },
        new Date(revealAt),
      );
    }
  }
}
