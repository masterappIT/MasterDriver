import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PROFILE_PHOTO_MAX } from '@masterdriver/shared';
import sharp from 'sharp';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { renderSeoTemplate } from '../site/seo-rules';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';
import { CARD_HEIGHT, PHOTO_WIDTH, cardSvg, type CardData, type PreviewMeta } from './preview-card';

const PLATE_KIND = { SINGLE: '單牌', DUAL: '兩地牌', TRIPLE: '三地牌' } as const;
/** The same as web/index.html, for any link that has no card of its own. */
const GENERIC = {
  title: '跨境師傅幫｜有單就派，有空就接',
  description: '跨境司機在微信群和 WhatsApp 群裡派單、搶單、請乘客確認的工具。免費使用。',
  image: '/share-card.jpg',
};
/** 名片頁 has no routes or regions since 2026-10-14, so the default title names only the driver. */
const PROFILE_TITLE = '{司機}｜跨境師傅幫';
const CODE = /^[A-Za-z0-9_-]{4,64}$/;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

type Kind = 'p' | 'c';
interface Resolved {
  meta: PreviewMeta;
  /** Null: the link has no card of its own and shows the generic one. */
  card: (Omit<CardData, 'photo'> & { photoKey: string | null }) | null;
}

/** 「7座商務車 · 兩地牌」, never a plate number. */
function vehicleLine(profile: { vehicleType: string | null; seats: number | null; plateType: keyof typeof PLATE_KIND | null } | null) {
  if (!profile) return null;
  const seats = profile.seats && !profile.vehicleType?.includes(`${profile.seats}座`) ? `${profile.seats}座` : null;
  const parts = [seats && profile.vehicleType ? `${seats}${profile.vehicleType}` : (profile.vehicleType ?? seats), profile.plateType ? PLATE_KIND[profile.plateType] : null];
  return parts.filter(Boolean).join(' · ') || null;
}

/**
 * Link previews for 名片頁 and passenger confirmation links (docs/DESIGN.md, 連結預覽). Only what
 * the page shows the public goes on a 名片頁 card. A confirmation card is about the dispatcher, whose
 * customer it is: who answers for the trip, how many they have arranged, their 名片頁 for next time;
 * their car only when they drive it themselves, and nothing of the driver who claimed it, the
 * passenger or the trip. Anything unknown, unpublished, taken down or cancelled gets the generic card.
 */
@Injectable()
export class LinkPreviewService {
  private readonly cache = new Map<string, { at: number; jpeg: Buffer }>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** The preview tags for a path a robot asked for, e.g. /p/AbCd1234. */
  async page(path: string): Promise<PreviewMeta> {
    const target = this.parse(path);
    const resolved = target ? await this.resolve(target.kind, target.code) : null;
    return resolved?.meta ?? this.generic(target ? path : '/');
  }

  /** What a link's card shows (the photo by its storage key), or null when it has none of its own. */
  async cardData(kind: string, code: string) {
    if ((kind !== 'p' && kind !== 'c') || !CODE.test(code)) return null;
    return (await this.resolve(kind, code))?.card ?? null;
  }

  /** The card image, or null when the link has none and the generic image is the answer. */
  async card(kind: string, code: string, now = Date.now()): Promise<Buffer | null> {
    const card = await this.cardData(kind, code);
    if (!card) return null;
    const key = `${kind}:${code}:${this.version(card)}`;
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.jpeg;
    const photo = card.photoKey ? await this.photo(card.photoKey) : null;
    const jpeg = await sharp(Buffer.from(cardSvg({ ...card, photo })))
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: now, jpeg });
    return jpeg;
  }

  private parse(path: string): { kind: Kind; code: string } | null {
    const match = /^\/([pc])\/([^/?#]+)\/?$/.exec(path);
    return match && CODE.test(match[2]) ? { kind: match[1] as Kind, code: match[2] } : null;
  }

  private generic(path: string): PreviewMeta {
    return { ...GENERIC, url: `${this.config.publicBaseUrl}${path}`, image: `${this.config.publicBaseUrl}${GENERIC.image}` };
  }

  /** A short hash of what is drawn: it goes in the image address, so a changed card is a new image to chat apps. */
  private version(card: NonNullable<Resolved['card']>) {
    return createHash('sha256').update(JSON.stringify(card)).digest('base64url').slice(0, 10);
  }

  private imageUrl(kind: Kind, code: string, card: NonNullable<Resolved['card']>) {
    return `${this.config.publicBaseUrl}/api/public/link-preview/card/${kind}/${code}.jpg?v=${this.version(card)}`;
  }

  private async resolve(kind: Kind, code: string): Promise<Resolved | null> {
    return kind === 'p' ? this.profile(code) : this.confirmation(code);
  }

  private completedTrips(userId: string) {
    return this.prisma.order.count({ where: { claimedById: userId, status: 'COMPLETED' } });
  }

  /** Trips they put out that were completed, whoever drove; a 接駁 counts once, by its first leg. */
  private arrangedTrips(userId: string) {
    return this.prisma.order.count({ where: { dispatcherId: userId, status: 'COMPLETED', OR: [{ legIndex: null }, { legIndex: 1 }] } });
  }

  /** The photo the public page shows first: of its newest PROFILE_PHOTO_MAX, the oldest. */
  private firstPhotoKey(photos: { storageKey: string }[]) {
    return photos.slice(-PROFILE_PHOTO_MAX)[0]?.storageKey ?? null;
  }

  private async profile(code: string): Promise<Resolved | null> {
    const page = await this.prisma.profilePage.findUnique({
      where: { code },
      include: {
        photos: { orderBy: { createdAt: 'asc' }, select: { storageKey: true } },
        user: { select: { profile: { select: { name: true, vehicleType: true, seats: true, plateType: true } } } },
      },
    });
    if (!page || !page.published || page.blockedAt) return null;
    const profile = page.user.profile;
    const name = profile?.name || '司機';
    const vehicle = vehicleLine(profile);
    const settings = await this.prisma.seoPageSetting.findUnique({ where: { page: 'PROFILE' } });
    // 路線 and 地區 stay empty: old values are still stored, but the page no longer shows them.
    const values = { 司機: name, 路線: null, 車型: profile?.vehicleType ?? null, 地區: null };
    const title = renderSeoTemplate(settings?.title || PROFILE_TITLE, values) || `${name}｜跨境師傅幫`;
    const description =
      (settings?.description && renderSeoTemplate(settings.description, values)) ||
      page.intro.trim().slice(0, 80) ||
      `看${name}的車和聯絡方式，直接在這裡約車，不用註冊。`;
    const card = {
      kind: 'profile' as const,
      name,
      vehicle,
      languages: page.languages,
      intro: page.intro,
      completedTrips: await this.completedTrips(page.userId),
      photoKey: this.firstPhotoKey(page.photos),
    };
    const url = `${this.config.publicBaseUrl}/p/${code}`;
    return { meta: { title, description, url, image: this.imageUrl('p', code, card) }, card };
  }

  private async confirmation(confirmCode: string): Promise<Resolved | null> {
    const order = await this.prisma.order.findUnique({
      where: { confirmCode },
      select: { status: true, dispatcherId: true, claimedById: true },
    });
    if (!order || order.status === 'CANCELLED') return null;
    const dispatcher = await this.prisma.user.findUnique({
      where: { id: order.dispatcherId },
      select: {
        profile: { select: { name: true, vehicleType: true, seats: true, plateType: true } },
        profilePage: { select: { published: true, blockedAt: true, photos: { orderBy: { createdAt: 'asc' }, select: { storageKey: true } } } },
      },
    });
    const name = dispatcher?.profile?.name || '';
    // Their own car only when they drive this trip themselves; another driver's would be the wrong car.
    const drivesIt = order.claimedById === order.dispatcherId;
    const page = dispatcher?.profilePage;
    const who = name || '為你安排的人';
    const card = {
      kind: 'confirm' as const,
      name: name || '司機',
      vehicle: drivesIt ? vehicleLine(dispatcher?.profile ?? null) : null,
      completedTrips: await this.arrangedTrips(order.dispatcherId),
      photoKey: drivesIt && page && !page.blockedAt ? this.firstPhotoKey(page.photos) : null,
      // The customer stays the dispatcher's: they answer for the trip, and their 名片頁 is where to book next time.
      owner: {
        line: name ? `行程由${name}負責，有問題請找${name}` : '行程由為你安排的人負責，有問題請找他',
        next: page?.published && !page.blockedAt ? `下次用車，可直接在${who}的名片頁約` : null,
      },
    };
    const title = name ? `${name}為你安排的行程｜跨境師傅幫` : '你的行程｜跨境師傅幫';
    const url = `${this.config.publicBaseUrl}/c/${confirmCode}`;
    return { meta: { title, description: '點開確認行程時間與上車地點。', url, image: this.imageUrl('c', confirmCode, card) }, card };
  }

  /** The stored photo cropped to the card's left side, as a data: URL the SVG can draw. */
  private async photo(key: string): Promise<string | null> {
    const bytes = await this.storage.read(key).catch(() => null);
    if (!bytes) return null;
    try {
      const jpeg = await sharp(bytes).rotate().resize(PHOTO_WIDTH, CARD_HEIGHT, { fit: 'cover' }).jpeg({ quality: 85 }).toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch {
      return null;
    }
  }
}
