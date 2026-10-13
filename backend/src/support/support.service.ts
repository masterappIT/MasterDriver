import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { SUPPORT_PAGE_SIZE, type AdminSupportQuery, type SupportText, type SupportThreadQuery } from '@masterdriver/shared';
import { Prisma } from '../../generated/prisma';
import { AuditService, PAGE_SIZE } from '../admin/audit.service';
import { randomCode, randomToken, sha256 } from '../common/crypto';
import { apiError } from '../common/errors';
import { readLimits } from '../common/limits';
import { PrismaService } from '../prisma.service';
import { sniffMedia } from './media-file';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';

const MINUTE_MS = 60_000;
const DAY_MS = 24 * 60 * MINUTE_MS;

/**
 * How many messages, files and guest conversations are allowed is set in the
 * platform admin (防濫用設定, see common/limits.ts). Guests are anonymous, so
 * they have their own, lower file limit and send no video.
 */
export const SUPPORT_LIMITS = {
  /** Pictures and videos are removed from storage after this long; the messages stay. */
  mediaRetentionDays: 180,
};

/** Who is writing to support: a signed-in user, or a guest holding the token of one conversation. */
export type Participant = { type: 'USER'; userId: string } | { type: 'GUEST'; conversationId: string };

export interface Staff {
  id: string;
  displayName: string;
}

const messageInclude = { media: true, staff: { select: { displayName: true } } } satisfies Prisma.SupportMessageInclude;
type MessageRow = Prisma.SupportMessageGetPayload<{ include: typeof messageInclude }>;

/** Users only ever see "客服"; which administrator replied is shown to staff alone. */
function toMessage(row: MessageRow, forStaff: boolean) {
  return {
    seq: row.seq,
    id: row.id,
    fromStaff: row.fromStaff,
    ...(forStaff ? { staffName: row.staff?.displayName ?? null } : {}),
    kind: row.kind,
    text: row.text,
    media: row.media
      ? { id: row.media.id, mime: row.media.mimeType, sizeBytes: row.media.sizeBytes, available: row.media.deletedAt === null }
      : null,
    createdAt: row.createdAt.toISOString(),
  };
}

const preview = (row: { kind: string; text: string } | undefined) =>
  !row ? '' : row.kind === 'IMAGE' ? '［圖片］' : row.kind === 'VIDEO' ? '［影片］' : row.text.slice(0, 60);

const isDuplicate = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class SupportService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ------------------------------------------------------- users and guests

  /**
   * A guest conversation and the token that is its only key. The token is
   * shown once and only its hash is kept: losing it loses the conversation.
   */
  async openGuest(ip: string | undefined, now = new Date()) {
    if (ip) {
      const recent = await this.prisma.supportConversation.count({
        where: { guestIp: ip, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
      });
      if (recent >= (await readLimits(this.prisma)).supportGuestConversationsPerIpPerDay) {
        throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'SUPPORT_GUEST_LIMIT', 'Too many guest conversations from this address');
      }
    }
    const token = randomToken();
    await this.prisma.supportConversation.create({ data: { guestTokenHash: sha256(token), guestIp: ip ?? null } });
    return { token };
  }

  async guestParticipant(token: string): Promise<Participant | null> {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { guestTokenHash: sha256(token) },
      select: { id: true },
    });
    return conversation ? { type: 'GUEST', conversationId: conversation.id } : null;
  }

  /** What this participant may send, so the apps can hide what would be refused. */
  uploadRules(participant: Participant | 'STAFF') {
    const guest = participant !== 'STAFF' && participant.type === 'GUEST';
    return { images: this.storage.available, videos: this.storage.available && !guest };
  }

  /** The conversation's messages; opening it marks the staff's replies as read. */
  async thread(participant: Participant, query: SupportThreadQuery) {
    const conversation = await this.find(participant);
    if (!conversation) return { messages: [], hasEarlier: false, uploads: this.uploadRules(participant) };
    const page = await this.page(conversation.id, query, false);
    if (conversation.unreadByParticipant > 0) {
      await this.prisma.supportConversation.update({ where: { id: conversation.id }, data: { unreadByParticipant: 0 } });
    }
    return { ...page, uploads: this.uploadRules(participant) };
  }

  async unread(participant: Participant) {
    return { count: (await this.find(participant))?.unreadByParticipant ?? 0 };
  }

  async sendText(participant: Participant, body: SupportText, now = new Date()) {
    const conversationId = await this.findOrCreate(participant);
    await this.checkPace(conversationId, now);
    return toMessage(await this.post(conversationId, null, { kind: 'TEXT', text: body.text }, body.clientMessageId, now), false);
  }

  async sendMedia(participant: Participant, bytes: Buffer, clientMessageId: string, now = new Date()) {
    const conversationId = await this.findOrCreate(participant);
    await this.checkPace(conversationId, now);
    const sentToday = await this.prisma.supportMessage.count({
      where: { conversationId, fromStaff: false, kind: { not: 'TEXT' }, createdAt: { gte: new Date(now.getTime() - DAY_MS) } },
    });
    const limits = await readLimits(this.prisma);
    const allowed = participant.type === 'USER' ? limits.supportUserMediaPerDay : limits.supportGuestMediaPerDay;
    if (sentToday >= allowed) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'SUPPORT_MEDIA_LIMIT', 'Too many pictures and videos today');
    }
    return toMessage(await this.postMedia(conversationId, null, bytes, clientMessageId, participant.type === 'USER', now), false);
  }

  /** A picture or video of the participant's own conversation, and of no other. */
  async media(participant: Participant, mediaId: string) {
    const conversation = await this.find(participant);
    if (!conversation) throw this.mediaNotFound();
    return this.readMedia({ id: mediaId, conversationId: conversation.id });
  }

  // ------------------------------------------------------------------ staff

  async waitingCount() {
    return this.prisma.supportConversation.count({ where: { waiting: true } });
  }

  /** The shared inbox: conversations waiting for a reply first come, first served; or all, newest first. */
  async list(query: AdminSupportQuery) {
    const where: Prisma.SupportConversationWhereInput = {
      ...(query.filter === 'waiting' ? { waiting: true } : { lastMessageAt: { not: null } }),
      ...(query.q
        ? { user: { OR: [{ phone: { contains: query.q } }, { profile: { name: { contains: query.q, mode: 'insensitive' } } }] } }
        : {}),
    };
    const [total, waiting, rows] = await Promise.all([
      this.prisma.supportConversation.count({ where }),
      this.waitingCount(),
      this.prisma.supportConversation.findMany({
        where,
        orderBy: { lastMessageAt: query.filter === 'waiting' ? 'asc' : 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          user: { select: { id: true, countryCode: true, phone: true, profile: { select: { name: true } } } },
          messages: { orderBy: { seq: 'desc' }, take: 1, select: { kind: true, text: true, fromStaff: true } },
        },
      }),
    ]);
    return {
      total,
      waiting,
      page: query.page,
      pageSize: PAGE_SIZE,
      items: rows.map((row) => ({
        id: row.id,
        participant: row.user ? ('USER' as const) : ('GUEST' as const),
        name: row.user?.profile?.name ?? null,
        phone: row.user ? `${row.user.countryCode} ${row.user.phone}` : null,
        waiting: row.waiting,
        lastMessageAt: row.lastMessageAt?.toISOString() ?? null,
        lastFromStaff: row.messages[0]?.fromStaff ?? false,
        preview: preview(row.messages[0]),
      })),
    };
  }

  async staffThread(conversationId: string, query: SupportThreadQuery) {
    const conversation = await this.prisma.supportConversation.findUnique({
      where: { id: conversationId },
      include: { user: { select: { id: true, countryCode: true, phone: true, createdAt: true, profile: { select: { name: true } } } } },
    });
    if (!conversation) throw this.conversationNotFound();
    return {
      conversation: {
        id: conversation.id,
        participant: conversation.user ? ('USER' as const) : ('GUEST' as const),
        userId: conversation.user?.id ?? null,
        name: conversation.user?.profile?.name ?? null,
        phone: conversation.user ? `${conversation.user.countryCode} ${conversation.user.phone}` : null,
        waiting: conversation.waiting,
        createdAt: conversation.createdAt.toISOString(),
      },
      ...(await this.page(conversationId, query, true)),
      uploads: this.uploadRules('STAFF'),
    };
  }

  /** 主動聯繫: the conversation of an existing user, created when there is none yet. */
  async openForUser(userId: string, staff: Staff, ip?: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    const id = await this.findOrCreate({ type: 'USER', userId });
    await this.audit.log({ adminId: staff.id, action: 'support.open', targetType: 'SupportConversation', targetId: id, ip });
    return { id };
  }

  async staffSendText(conversationId: string, staff: Staff, body: SupportText, ip?: string, now = new Date()) {
    await this.requireConversation(conversationId);
    const message = await this.post(conversationId, staff.id, { kind: 'TEXT', text: body.text }, body.clientMessageId, now);
    await this.logReply(conversationId, staff, 'TEXT', ip);
    return toMessage(message, true);
  }

  async staffSendMedia(conversationId: string, staff: Staff, bytes: Buffer, clientMessageId: string, ip?: string, now = new Date()) {
    await this.requireConversation(conversationId);
    const message = await this.postMedia(conversationId, staff.id, bytes, clientMessageId, true, now);
    await this.logReply(conversationId, staff, message.kind, ip);
    return toMessage(message, true);
  }

  async staffMedia(mediaId: string) {
    return this.readMedia({ id: mediaId });
  }

  /**
   * Removes the bytes of every picture and video past its keep-until time.
   * The records and messages stay, marked as no longer available. Safe to run
   * again: a file that is already gone counts as removed.
   */
  async purgeExpiredMedia(now = new Date()) {
    let removed = 0;
    for (;;) {
      const batch = await this.prisma.supportMedia.findMany({
        where: { deletedAt: null, expiresAt: { lte: now } },
        select: { id: true, storageKey: true },
        take: 100,
      });
      if (batch.length === 0) return { removed };
      for (const media of batch) {
        await this.storage.remove(media.storageKey);
        await this.prisma.supportMedia.update({ where: { id: media.id }, data: { deletedAt: now } });
        removed += 1;
      }
    }
  }

  // --------------------------------------------------------------- internals

  private find(participant: Participant) {
    return this.prisma.supportConversation.findUnique({
      where: participant.type === 'USER' ? { userId: participant.userId } : { id: participant.conversationId },
      select: { id: true, unreadByParticipant: true },
    });
  }

  private async findOrCreate(participant: Participant) {
    if (participant.type === 'GUEST') return participant.conversationId;
    const where = { userId: participant.userId };
    const found = await this.prisma.supportConversation.findUnique({ where, select: { id: true } });
    if (found) return found.id;
    try {
      return (await this.prisma.supportConversation.create({ data: where, select: { id: true } })).id;
    } catch (error) {
      // The user's first two messages arrived together: the other one made the conversation.
      if (!isDuplicate(error)) throw error;
      return (await this.prisma.supportConversation.findUniqueOrThrow({ where, select: { id: true } })).id;
    }
  }

  private async requireConversation(id: string) {
    if ((await this.prisma.supportConversation.count({ where: { id } })) === 0) throw this.conversationNotFound();
  }

  private async checkPace(conversationId: string, now: Date) {
    const recent = await this.prisma.supportMessage.count({
      where: { conversationId, fromStaff: false, createdAt: { gte: new Date(now.getTime() - MINUTE_MS) } },
    });
    if (recent >= (await readLimits(this.prisma)).supportMessagesPerMinute) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'SUPPORT_TOO_FAST', 'Too many messages; wait a moment');
    }
  }

  private async page(conversationId: string, query: SupportThreadQuery, forStaff: boolean) {
    if (query.after !== undefined) {
      const rows = await this.prisma.supportMessage.findMany({
        where: { conversationId, seq: { gt: query.after } },
        orderBy: { seq: 'asc' },
        take: SUPPORT_PAGE_SIZE,
        include: messageInclude,
      });
      return { messages: rows.map((row) => toMessage(row, forStaff)), hasEarlier: false };
    }
    const rows = await this.prisma.supportMessage.findMany({
      where: { conversationId, ...(query.before !== undefined ? { seq: { lt: query.before } } : {}) },
      orderBy: { seq: 'desc' },
      take: SUPPORT_PAGE_SIZE + 1,
      include: messageInclude,
    });
    const hasEarlier = rows.length > SUPPORT_PAGE_SIZE;
    return { messages: rows.slice(0, SUPPORT_PAGE_SIZE).reverse().map((row) => toMessage(row, forStaff)), hasEarlier };
  }

  private existing(conversationId: string, fromStaff: boolean, clientMessageId: string) {
    return this.prisma.supportMessage.findUnique({
      where: { conversationId_fromStaff_clientMessageId: { conversationId, fromStaff, clientMessageId } },
      include: messageInclude,
    });
  }

  /**
   * Adds a message and moves the conversation's state with it, together. A
   * message sent again with the same client id is returned, not added twice.
   */
  private async post(
    conversationId: string,
    staffId: string | null,
    content: { kind: 'TEXT' | 'IMAGE' | 'VIDEO'; text: string; media?: Prisma.SupportMediaUncheckedCreateInput },
    clientMessageId: string,
    now: Date,
  ): Promise<MessageRow> {
    const fromStaff = staffId !== null;
    try {
      return await this.prisma.$transaction(async (tx) => {
        if (content.media) await tx.supportMedia.create({ data: content.media });
        const message = await tx.supportMessage.create({
          data: { conversationId, fromStaff, staffId, kind: content.kind, text: content.text, clientMessageId, mediaId: content.media?.id, createdAt: now },
          include: messageInclude,
        });
        await tx.supportConversation.update({
          where: { id: conversationId },
          data: fromStaff
            ? { lastMessageAt: now, waiting: false, unreadByParticipant: { increment: 1 } }
            : { lastMessageAt: now, waiting: true, unreadByParticipant: 0 },
        });
        return message;
      });
    } catch (error) {
      const first = isDuplicate(error) ? await this.existing(conversationId, fromStaff, clientMessageId) : null;
      if (!first) throw error;
      return first;
    }
  }

  /**
   * The file goes to storage first and the message second. If the message
   * cannot be saved, the file is taken out again, so storage never holds a
   * file no message points to.
   */
  private async postMedia(conversationId: string, staffId: string | null, bytes: Buffer, clientMessageId: string, videoAllowed: boolean, now: Date) {
    const type = sniffMedia(bytes);
    if (!type) throw apiError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'SUPPORT_MEDIA_TYPE', 'Only PNG, JPEG, WebP, MP4, MOV and WebM are accepted');
    if (bytes.length > type.maxBytes) throw apiError(HttpStatus.PAYLOAD_TOO_LARGE, 'SUPPORT_MEDIA_TOO_LARGE', 'The file is too large');
    if (type.kind === 'VIDEO' && !videoAllowed) throw apiError(HttpStatus.FORBIDDEN, 'SUPPORT_VIDEO_SIGN_IN', 'Sign in to send a video');
    if (!this.storage.available) throw apiError(HttpStatus.SERVICE_UNAVAILABLE, 'SUPPORT_MEDIA_UNAVAILABLE', 'Media storage is not configured');

    const sent = await this.existing(conversationId, staffId !== null, clientMessageId);
    if (sent) return sent;

    const id = randomCode(24);
    const storageKey = `support/${conversationId}/${id}.${type.extension}`;
    await this.storage.put(storageKey, bytes, type.mime);
    const media = {
      id,
      conversationId,
      kind: type.kind,
      mimeType: type.mime,
      sizeBytes: bytes.length,
      storageKey,
      checksum: sha256Bytes(bytes),
      createdAt: now,
      expiresAt: new Date(now.getTime() + SUPPORT_LIMITS.mediaRetentionDays * DAY_MS),
    };
    try {
      const message = await this.post(conversationId, staffId, { kind: type.kind, text: '', media }, clientMessageId, now);
      // The same message sent twice at once: the first one's file is the one kept.
      if (message.mediaId !== id) await this.storage.remove(storageKey);
      return message;
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
  }

  private async readMedia(where: { id: string; conversationId?: string }) {
    const media = await this.prisma.supportMedia.findFirst({ where: { ...where, deletedAt: null } });
    const bytes = media ? await this.storage.read(media.storageKey) : null;
    if (!media || !bytes) throw this.mediaNotFound();
    return { mime: media.mimeType, bytes };
  }

  private logReply(conversationId: string, staff: Staff, kind: string, ip?: string) {
    // The audit trail says who replied and when; what was said stays in the conversation.
    return this.audit.log({ adminId: staff.id, action: 'support.reply', targetType: 'SupportConversation', targetId: conversationId, detail: { kind }, ip });
  }

  private conversationNotFound() {
    return apiError(HttpStatus.NOT_FOUND, 'SUPPORT_CONVERSATION_NOT_FOUND', 'Conversation not found');
  }

  private mediaNotFound() {
    return apiError(HttpStatus.NOT_FOUND, 'SUPPORT_MEDIA_NOT_FOUND', 'The file is not available');
  }
}

const sha256Bytes = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
