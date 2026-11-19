import { Inject, Injectable } from '@nestjs/common';
import { verifyStripeWebhookSignature } from '../channels/stripe-config';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma.service';

/** The parts of a MasterBox webhook event (masterbox-platform backend/openapi/v1.yaml, WebhookEvent) read here. */
export interface MasterBoxEvent {
  id?: string;
  type?: string;
  data?: {
    customer_id?: string | null;
    message?: {
      direction?: 'inbound' | 'outbound';
      sender?: { type?: 'agent' | 'guest' | 'customer' | 'system' };
      created_at?: string;
    };
  };
}

/**
 * MasterBox signs each event like Stripe does: `X-MasterBox-Signature: t=<unix>,v1=<hex>[,v1=<hex>]`, HMAC-SHA256 of
 * `<t>.<the exact body>` with the endpoint's secret (whsec_...), two v1 for a day after the secret is changed; an event
 * more than 5 minutes off is refused.
 */
export function verifyMasterBoxSignature(rawBody: Buffer, header: string | undefined, secret: string, nowMs = Date.now()) {
  return verifyStripeWebhookSignature(rawBody, header, secret, nowMs);
}

export type SupportEvent = { kind: 'reply'; userId: string; at: Date } | { kind: 'read'; userId: string } | null;

/**
 * What an event means for a driver's notifications: staff (or our API, which sends as staff, or a system message)
 * wrote to them; or they read what was written. Anything else, or a conversation with no customer of ours, is nothing.
 */
export function supportEventOf(event: MasterBoxEvent): SupportEvent {
  const userId = event.data?.customer_id;
  if (!userId) return null;
  if (event.type === 'message.read') return { kind: 'read', userId };
  if (event.type !== 'message.created') return null;
  const message = event.data?.message;
  if (message?.direction !== 'outbound') return null;
  if (message.sender?.type !== 'agent' && message.sender?.type !== 'system') return null;
  const at = new Date(message.created_at ?? '');
  return { kind: 'reply', userId, at: Number.isNaN(at.getTime()) ? new Date() : at };
}

/**
 * 客服 replies are notifications again (2026-11-20): MasterBox tells us of each message its staff send a driver,
 * and the driver gets the one 「客服回覆了你」 line, as with the platform's own 客服 before; reading it in the chat
 * reads the line. MasterBox sends an event again until it is answered, so a message the driver read after it was
 * sent never brings the line back.
 */
@Injectable()
export class MasterBoxWebhook {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async handle(event: MasterBoxEvent, now = new Date()) {
    const meant = supportEventOf(event);
    if (!meant) return;
    if (meant.kind === 'read') return this.notifications.supportRead(meant.userId, now);
    const readSince = await this.prisma.notification.findFirst({
      where: { userId: meant.userId, kind: 'SUPPORT_REPLY', readAt: { gte: meant.at } },
      select: { id: true },
    });
    if (readSince) return;
    await this.notifications.send(
      { userId: meant.userId, kind: 'SUPPORT_REPLY', group: 'SUPPORT', dedupeKey: event.id ? `masterbox:${event.id}` : undefined },
      now,
    );
  }
}
