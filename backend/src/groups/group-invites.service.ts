import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { GroupInviteCreate, GroupInviteUpdate } from '@masterdriver/shared';
import type { GroupInvite } from '../../generated/prisma';
import { apiError } from '../common/errors';
import { PrismaService } from '../prisma.service';
import { decodeQrImage } from './qr-image';

const MAX_INVITES = 5;
/** WeChat group QR codes stop working seven days after they are generated. */
export const WECHAT_GROUP_QR_DAYS = 7;

const iso = (date: Date | null) => date?.toISOString() ?? null;

function view(invite: GroupInvite, now: Date) {
  return {
    id: invite.id,
    platform: invite.platform,
    name: invite.name,
    inviteUrl: invite.inviteUrl,
    qrUrl: invite.qrImage ? `/api/public/group-invites/${invite.id}/qr?v=${invite.updatedAt.getTime()}` : null,
    expiresAt: iso(invite.expiresAt),
    expired: Boolean(invite.expiresAt && invite.expiresAt <= now),
    showOnClaimPage: invite.showOnClaimPage,
  };
}

/** Dispatchers' own WeChat / WhatsApp groups, offered to drivers on their claim pages. */
@Injectable()
export class GroupInvitesService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private qr(dataUrl: string | undefined) {
    if (dataUrl === undefined) return undefined;
    const image = decodeQrImage(dataUrl);
    if (!image) throw apiError(HttpStatus.BAD_REQUEST, 'QR_IMAGE_INVALID', 'Upload a PNG, JPEG or WebP image up to 400 KB');
    return image;
  }

  private expiry(platform: GroupInvite['platform'], now: Date) {
    return platform === 'WECHAT' ? new Date(now.getTime() + WECHAT_GROUP_QR_DAYS * 24 * 60 * 60 * 1000) : null;
  }

  async list(ownerId: string, now = new Date()) {
    const invites = await this.prisma.groupInvite.findMany({ where: { ownerId }, orderBy: { createdAt: 'asc' } });
    return invites.map((invite) => view(invite, now));
  }

  async create(ownerId: string, input: GroupInviteCreate, now = new Date()) {
    if ((await this.prisma.groupInvite.count({ where: { ownerId } })) >= MAX_INVITES) {
      throw apiError(HttpStatus.CONFLICT, 'GROUP_INVITE_LIMIT', `At most ${MAX_INVITES} groups`);
    }
    const image = input.platform === 'WHATSAPP' ? undefined : this.qr(input.qrImage);
    await this.prisma.groupInvite.create({
      data: {
        ownerId,
        platform: input.platform,
        name: input.name,
        inviteUrl: input.platform === 'WHATSAPP' ? input.inviteUrl : null,
        qrImage: image?.bytes,
        qrMime: image?.mime,
        expiresAt: this.expiry(input.platform, now),
        showOnClaimPage: input.showOnClaimPage,
      },
    });
    return this.list(ownerId, now);
  }

  async update(ownerId: string, id: string, input: GroupInviteUpdate, now = new Date()) {
    const invite = await this.prisma.groupInvite.findFirst({ where: { id, ownerId } });
    if (!invite) throw apiError(HttpStatus.NOT_FOUND, 'GROUP_INVITE_NOT_FOUND', 'Group not found');
    const image = invite.platform === 'WHATSAPP' ? undefined : this.qr(input.qrImage);
    await this.prisma.groupInvite.update({
      where: { id },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.showOnClaimPage === undefined ? {} : { showOnClaimPage: input.showOnClaimPage }),
        ...(invite.platform === 'WHATSAPP' && input.inviteUrl ? { inviteUrl: input.inviteUrl } : {}),
        // A new WeChat group QR starts a new seven-day window.
        ...(image ? { qrImage: image.bytes, qrMime: image.mime, expiresAt: this.expiry(invite.platform, now) } : {}),
      },
    });
    return this.list(ownerId, now);
  }

  async remove(ownerId: string, id: string) {
    const deleted = await this.prisma.groupInvite.deleteMany({ where: { id, ownerId } });
    if (deleted.count === 0) throw apiError(HttpStatus.NOT_FOUND, 'GROUP_INVITE_NOT_FOUND', 'Group not found');
    return this.list(ownerId);
  }

  /** The image behind a QR link; nothing once a WeChat group QR has expired. */
  async qrImage(id: string, now = new Date()) {
    const invite = await this.prisma.groupInvite.findUnique({ where: { id }, select: { qrImage: true, qrMime: true, expiresAt: true } });
    if (!invite?.qrImage || !invite.qrMime || (invite.expiresAt && invite.expiresAt <= now)) return null;
    return { mime: invite.qrMime, bytes: Buffer.from(invite.qrImage) };
  }

  /** For staff looking into a complaint: the QR image of one of the user's groups, expired or not. */
  async staffQr(ownerId: string, id: string) {
    const invite = await this.prisma.groupInvite.findFirst({ where: { id, ownerId }, select: { qrImage: true, qrMime: true } });
    if (!invite?.qrImage || !invite.qrMime) return null;
    return { mime: invite.qrMime, bytes: Buffer.from(invite.qrImage) };
  }

  /** What a claim page offers: groups the dispatcher chose to show that still work. */
  async forClaimPage(ownerId: string, now = new Date()) {
    const invites = await this.prisma.groupInvite.findMany({
      where: { ownerId, showOnClaimPage: true, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      orderBy: { createdAt: 'asc' },
    });
    return invites.map((invite) => {
      const { id, platform, name, inviteUrl, qrUrl } = view(invite, now);
      return { id, platform, name, inviteUrl, qrUrl };
    });
  }
}
