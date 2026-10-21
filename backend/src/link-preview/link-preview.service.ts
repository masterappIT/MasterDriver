import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { PROFILE_PHOTO_MAX, plateRegions } from '@masterdriver/shared';
import sharp from 'sharp';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { renderSeoTemplate } from '../site/seo-rules';
import { formatPickup } from '../common/hong-kong-time';
import { formatPrice, isReversed, roundTripTotal } from '../orders/share-text';
import { ACTIVE } from '../deals/deal-hold';
import { dealPriceText, formatDealTime } from '../deals/deal-share-text';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';
import {
  PHOTO_HEIGHT,
  PHOTO_WIDTH,
  SQUARE,
  SQUARE_PHOTO_HEIGHT,
  cardSvg,
  squareSvg,
  type CardData,
  type PreviewMeta,
  type SquareData,
} from './preview-card';

const PLATE_KIND = { SINGLE: '單牌', DUAL: '兩地牌', TRIPLE: '三地牌' } as const;
/**
 * The home page, and any link that has no card of its own: the same words as web/index.html,
 * whose tags every other page carries. Robots get the wide picture, a visitor's tags the square.
 */
export const HOME = {
  title: 'MasterDriver 跨境師傅幫｜跨境司機派單、接單、獲客',
  description: '一條連結派單到多個群，司機搶單；名片頁讓客人直接約你。免費。',
  image: '/share-card.jpg',
  square: '/share-square.jpg',
};
/**
 * 名片頁 has no routes or regions since 2026-10-14, so the default title names only the driver.
 * Short enough for the two lines a WeChat card gives a title (2026-10-15).
 */
export const PROFILE_TITLE = '{司機}｜跨境司機名片';
const CODE = /^[A-Za-z0-9_-]{4,64}$/;
const CACHE_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

type Kind = 'p' | 'c' | 'o' | 'r' | 'd';
type Stored<T> = T extends { photo: string | null } ? Omit<T, 'photo'> & { photoKey: string | null } : T;
interface Resolved {
  title: string;
  description: string;
  url: string;
  /** The wide card; null when the link has none (a 搶單 link), and its square stands in. */
  card: Stored<CardData> | null;
  square: Stored<SquareData>;
}

/** What a card may say about the car: no plate numbers are ever read out of these. */
const CAR = { name: true, vehicleType: true, seats: true, color: true, plateType: true, hkPlate: true, macauPlate: true, mainlandPlate: true } as const;

/** The band under the photo: 「香港」「粵Z」 drawn as plates, and 「兩地牌・7座」. */
function platesBand(profile: { seats: number | null; plateType: keyof typeof PLATE_KIND | null; hkPlate: string | null; macauPlate: string | null; mainlandPlate: string | null } | null) {
  if (!profile) return null;
  const label = [profile.plateType ? PLATE_KIND[profile.plateType] : null, profile.seats ? `${profile.seats}座` : null].filter(Boolean).join('・');
  return { regions: plateRegions(profile), label: label || null };
}

/** 「7座商務車 · 兩地牌」, never a plate number. */
function vehicleLine(profile: { vehicleType: string | null; seats: number | null; plateType: keyof typeof PLATE_KIND | null } | null) {
  if (!profile) return null;
  const seats = profile.seats && !profile.vehicleType?.includes(`${profile.seats}座`) ? `${profile.seats}座` : null;
  const parts = [seats && profile.vehicleType ? `${seats}${profile.vehicleType}` : (profile.vehicleType ?? seats), profile.plateType ? PLATE_KIND[profile.plateType] : null];
  return parts.filter(Boolean).join(' · ') || null;
}

/**
 * Link previews for 名片頁, passenger confirmation and 搶單 links (docs/DESIGN.md, 連結預覽). Only what
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

  /**
   * The preview tags for a path a robot asked for, e.g. /p/AbCd1234: the wide card where the link
   * has one (WhatsApp, iMessage), else its square; the home page's for anything else.
   */
  async page(path: string): Promise<PreviewMeta> {
    const target = this.parse(path);
    const resolved = target ? await this.resolve(target.kind, target.code) : null;
    if (!resolved) return this.home(target ? path : '/', false);
    const image = resolved.card ? this.imageUrl('card', target!, resolved.card) : this.imageUrl('square', target!, resolved.square);
    return { title: resolved.title, description: resolved.description, url: resolved.url, image, square: !resolved.card };
  }

  /**
   * The tags every visitor's page carries for a /p/, /c/, /o/, /r/ or /d/ link (nginx puts them in, see
   * deploy/frontend/web.conf), with the square: what iOS's share menu hands WeChat. Null when the
   * link has no preview of its own, and the page keeps the home tags it was built with.
   */
  async tags(path: string): Promise<PreviewMeta | null> {
    const target = this.parse(path);
    const resolved = target ? await this.resolve(target.kind, target.code) : null;
    if (!target || !resolved) return null;
    return { title: resolved.title, description: resolved.description, url: resolved.url, image: this.imageUrl('square', target, resolved.square), square: true };
  }

  /** What a link's wide card shows (the photo by its storage key), or null when it has none of its own. */
  async cardData(kind: string, code: string) {
    const target = this.target(kind, code);
    return target ? ((await this.resolve(target.kind, target.code))?.card ?? null) : null;
  }

  /** What a link's square shows, or null when it has none and the home square is the answer. */
  async squareData(kind: string, code: string) {
    const target = this.target(kind, code);
    return target ? ((await this.resolve(target.kind, target.code))?.square ?? null) : null;
  }

  /** The wide card image, or null when the link has none and the generic image is the answer. */
  async card(kind: string, code: string, now = Date.now()): Promise<Buffer | null> {
    const card = await this.cardData(kind, code);
    if (!card) return null;
    return this.drawn(`card:${kind}:${code}:${this.version(card)}`, now, async () => {
      const photo = card.photoKey ? await this.photo(card.photoKey, PHOTO_WIDTH, PHOTO_HEIGHT) : null;
      return cardSvg({ ...card, photo });
    });
  }

  /** The square image, or null when the link has none and the home square is the answer. */
  async square(kind: string, code: string, now = Date.now()): Promise<Buffer | null> {
    const square = await this.squareData(kind, code);
    if (!square) return null;
    return this.drawn(`square:${kind}:${code}:${this.version(square)}`, now, async () => {
      if (square.kind !== 'driver') return squareSvg(square);
      const photo = square.photoKey ? await this.photo(square.photoKey, SQUARE, SQUARE_PHOTO_HEIGHT) : null;
      return squareSvg({ kind: 'driver', name: square.name, photo });
    });
  }

  private async drawn(key: string, now: number, svg: () => Promise<string>) {
    const hit = this.cache.get(key);
    if (hit && now - hit.at < CACHE_MS) return hit.jpeg;
    const jpeg = await sharp(Buffer.from(await svg()))
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    if (this.cache.size >= CACHE_MAX) this.cache.delete(this.cache.keys().next().value as string);
    this.cache.set(key, { at: now, jpeg });
    return jpeg;
  }

  private target(kind: string, code: string): { kind: Kind; code: string } | null {
    return (kind === 'p' || kind === 'c' || kind === 'o' || kind === 'r' || kind === 'd') && CODE.test(code) ? { kind, code } : null;
  }

  private parse(path: string): { kind: Kind; code: string } | null {
    const match = /^\/([pcord])\/([^/?#]+)\/?$/.exec(path);
    return match ? this.target(match[1], match[2]) : null;
  }

  private home(path: string, square: boolean): PreviewMeta {
    const base = this.config.publicBaseUrl;
    return { title: HOME.title, description: HOME.description, url: `${base}${path}`, image: `${base}${square ? HOME.square : HOME.image}`, square };
  }

  /** A short hash of what is drawn: it goes in the image address, so a changed card is a new image to chat apps. */
  private version(drawn: object) {
    return createHash('sha256').update(JSON.stringify(drawn)).digest('base64url').slice(0, 10);
  }

  private imageUrl(shape: 'card' | 'square', target: { kind: Kind; code: string }, drawn: object) {
    return `${this.config.publicBaseUrl}/api/public/link-preview/${shape}/${target.kind}/${target.code}.jpg?v=${this.version(drawn)}`;
  }

  private async resolve(kind: Kind, code: string): Promise<Resolved | null> {
    if (kind === 'p') return this.profile(code);
    if (kind === 'r') return this.carpool(code);
    if (kind === 'd') return this.deal(code);
    return kind === 'c' ? this.confirmation(code) : this.claim(code);
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
        user: { select: { profile: { select: CAR } } },
      },
    });
    if (!page || !page.published || page.blockedAt) return null;
    const profile = page.user.profile;
    const name = profile?.name || '司機';

    const settings = await this.prisma.seoPageSetting.findUnique({ where: { page: 'PROFILE' } });
    // 路線 and 地區 stay empty: old values are still stored, but the page no longer shows them.
    const values = { 司機: name, 路線: null, 車型: profile?.vehicleType ?? null, 地區: null };
    const title = renderSeoTemplate(settings?.title || PROFILE_TITLE, values) || `${name}｜跨境師傅幫`;
    // 「埃爾法・黑・兩地牌 7 座。點開直接約車，不用註冊。」: the car first, short enough for a WeChat card.
    const plateKind = profile?.plateType ? PLATE_KIND[profile.plateType] : null;
    const car = [profile?.vehicleType, profile?.color, [plateKind, profile?.seats ? `${profile.seats} 座` : null].filter(Boolean).join(' ')].filter(Boolean).join('・');
    const description =
      (settings?.description && renderSeoTemplate(settings.description, values)) || `${car ? `${car}。` : ''}點開直接約車，不用註冊。`;
    const photoKey = this.firstPhotoKey(page.photos);
    const card = {
      kind: 'profile' as const,
      name,
      // The car's type and colour here; its plates and seats are in the band under the photo.
      vehicle: [profile?.vehicleType, profile?.color].filter(Boolean).join('・') || null,
      plates: platesBand(profile),
      contacts: { whatsapp: Boolean(page.whatsapp), wechat: Boolean(page.wechatId), phone: true },
      languages: page.languages,
      intro: page.intro,
      completedTrips: await this.completedTrips(page.userId),
      photoKey,
    };
    const url = `${this.config.publicBaseUrl}/p/${code}`;
    return { title, description, url, card, square: { kind: 'driver', name, photoKey } };
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
        profile: { select: CAR },
        profilePage: { select: { published: true, blockedAt: true, photos: { orderBy: { createdAt: 'asc' }, select: { storageKey: true } } } },
      },
    });
    const name = dispatcher?.profile?.name || '';
    // Their own car only when they drive this trip themselves; another driver's would be the wrong car.
    const drivesIt = order.claimedById === order.dispatcherId;
    const page = dispatcher?.profilePage;
    const who = name || '為你安排的人';
    const photoKey = drivesIt && page && !page.blockedAt ? this.firstPhotoKey(page.photos) : null;
    const card = {
      kind: 'confirm' as const,
      name: name || '司機',
      vehicle: drivesIt ? vehicleLine(dispatcher?.profile ?? null) : null,
      // Their plates only with their own car: another driver's car would carry other plates.
      plates: drivesIt ? platesBand(dispatcher?.profile ?? null) : null,
      completedTrips: await this.arrangedTrips(order.dispatcherId),
      photoKey,
      // The customer stays the dispatcher's: they answer for the trip, and their 名片頁 is where to book next time.
      owner: {
        line: name ? `行程由${name}負責，有問題請找${name}` : '行程由為你安排的人負責，有問題請找他',
        next: page?.published && !page.blockedAt ? `下次用車，可直接在${who}的名片頁約` : null,
      },
    };
    const title = name ? `${name}為你安排的行程` : '為你安排的行程';
    const description = `點開確認時間與上車地點。${name ? `行程由${name}負責。` : ''}`;
    const url = `${this.config.publicBaseUrl}/c/${confirmCode}`;
    // Their car (or initial) only when they drive it; otherwise 為你安排的行程, never a stranger's initial.
    const square: Resolved['square'] = drivesIt ? { kind: 'driver', name: name || '司機', photoKey } : { kind: 'confirm' };
    return { title, description, url, card, square };
  }

  /**
   * A 搶單 link: what the group text already says (when, where, the car, the driver price) and
   * whose order it is, as the claim page shows anyone (2026-10-15). Never the passenger or their
   * price. Only while a driver can still take it; a 接駁 while any of its legs can.
   */
  private async claim(code: string): Promise<Resolved | null> {
    const order = await this.prisma.order.findUnique({
      where: { code },
      select: {
        status: true,
        pickupAt: true,
        immediate: true,
        origin: true,
        destination: true,
        vehicleType: true,
        driverPriceMinor: true,
        driverCurrency: true,
        journeyId: true,
        journeyKind: true,
        sameDriver: true,
        dispatcherId: true,
        claimedById: true,
        dispatcher: { select: { profile: { select: { name: true } } } },
      },
    });
    if (!order) return null;
    const legs = order.journeyId
      ? await this.prisma.order.findMany({
          where: { journeyId: order.journeyId },
          orderBy: { legIndex: 'asc' },
          select: { status: true, pickupAt: true, immediate: true, origin: true, destination: true, driverPriceMinor: true, driverCurrency: true, claimedById: true },
        })
      : [order];
    if (!legs.some((leg) => leg.status === 'OPEN')) return null;
    const first = legs[0];
    const several = legs.length > 1;
    // 往返: there and back, A⇄B; 接駁: A→C over its legs.
    const roundTrip = several && order.journeyKind === 'ROUND_TRIP';
    const transfer = several && !roundTrip;
    // 同一位司機來回: one driver is paid for both legs, so the preview says what together.
    const total =
      roundTrip && order.sameDriver ? roundTripTotal(legs.map((leg) => ({ ...leg, selfDriven: leg.claimedById === order.dispatcherId }))) : null;
    const badge = first.immediate ? '即時' : '有單';
    const name = order.dispatcher.profile?.name;
    // 往返 back the way it went reads A⇄B; back from or to somewhere else, both legs' places.
    const title = roundTrip
      ? isReversed(legs)
        ? `【${badge}・往返】${first.origin}⇄${first.destination}`
        : `【${badge}・往返】${first.origin}→${first.destination}・回程 ${legs[1].origin}→${legs[1].destination}`
      : `【${badge}${transfer ? '・接駁' : ''}】${first.origin}→${legs[legs.length - 1].destination}`;
    const facts = [
      first.immediate ? '現在出發' : formatPickup(first.pickupAt),
      transfer ? `接駁 ${legs.length} 段` : null,
      roundTrip ? `回程 ${formatPickup(legs[1].pickupAt)}` : null,
      order.vehicleType,
      total ? `來回 ${total}` : null,
      // A 接駁's or 往返's legs each have their own price, so the text has them all and the preview
      // none, but for what 同一位司機來回 pays together.
      !several && order.driverPriceMinor !== null ? formatPrice(order.driverPriceMinor, order.driverCurrency) : null,
    ].filter(Boolean);
    const description = `${facts.join('・')}。${name ? `${name}出的單，` : ''}點開搶單，先搶先得。`;
    // 「10/16 02:57」: the weekday would not fit at the square's size.
    const when = first.immediate ? '現在出發' : formatPickup(first.pickupAt).replace(/（.）/, ' ');
    return { title, description, url: `${this.config.publicBaseUrl}/o/${code}`, card: null, square: { kind: 'order', badge, when } };
  }

  /**
   * A 拼車 link (/r/): what the driver's own invite text says, the trip and the price a seat, and
   * whose carpool it is, with the car photo the carpool page shows (2026-10-20). Never the seats
   * left: chat apps keep a card long after more seats are taken. Never a passenger. Only while it
   * takes seats; a closed, cancelled or ordered one gets the generic card. A passenger's own link
   * (/s/) is their credential and always gets the generic card.
   */
  private async carpool(code: string): Promise<Resolved | null> {
    const carpool = await this.prisma.carpool.findUnique({
      where: { code },
      select: {
        status: true,
        closesAt: true,
        pickupAt: true,
        origin: true,
        destination: true,
        seatPriceMinor: true,
        seatCurrency: true,
        driver: {
          select: {
            profile: { select: { name: true } },
            // The photo the carpool page shows: the newest of a 名片頁 not taken down.
            profilePage: { select: { blockedAt: true, photos: { orderBy: { createdAt: 'desc' }, take: 1, select: { storageKey: true } } } },
          },
        },
      },
    });
    if (!carpool || carpool.status !== 'OPEN' || carpool.closesAt <= new Date()) return null;
    const name = carpool.driver.profile?.name;
    const page = carpool.driver.profilePage;
    const price = carpool.seatPriceMinor !== null ? `每位 ${formatPrice(carpool.seatPriceMinor, carpool.seatCurrency)}` : '每位價錢請私訊';
    const title = `【拼車】${formatPickup(carpool.pickupAt)} ${carpool.origin} → ${carpool.destination}`;
    const description = `${price}。${name ? `${name}開的拼車，` : ''}點開報位，不用註冊。`;
    const photoKey = page && !page.blockedAt ? (page.photos[0]?.storageKey ?? null) : null;
    return { title, description, url: `${this.config.publicBaseUrl}/r/${code}`, card: null, square: { kind: 'driver', name: name || '司機', photoKey } };
  }

  /**
   * A 特價車 link (/d/): what the driver's own text says, the time, the route and the price, and
   * whose deal it is, with the car photo the deal page shows (2026-10-21). Only while it takes
   * bookings; a closed, full, taken down or expired one gets the generic card.
   */
  private async deal(code: string): Promise<Resolved | null> {
    const deal = await this.prisma.deal.findUnique({
      where: { code },
      select: {
        status: true,
        pickupAt: true,
        pickupUntil: true,
        origin: true,
        destination: true,
        priceMinor: true,
        currency: true,
        originalPriceMinor: true,
        maxBookings: true,
        _count: { select: { bookings: { where: { status: { in: ACTIVE } } } } },
        driver: {
          select: {
            profile: { select: { name: true } },
            profilePage: { select: { blockedAt: true, photos: { orderBy: { createdAt: 'desc' }, take: 1, select: { storageKey: true } } } },
          },
        },
      },
    });
    if (!deal || deal.status !== 'OPEN' || (deal.pickupUntil ?? deal.pickupAt) <= new Date()) return null;
    if (deal.maxBookings !== null && deal._count.bookings >= deal.maxBookings) return null;
    const name = deal.driver.profile?.name;
    const page = deal.driver.profilePage;
    const title = `【特價車】${formatDealTime(deal)} ${deal.origin} → ${deal.destination}`;
    const description = `${dealPriceText(deal)}。${name ? `${name}的特價車，` : ''}點開預約，不用註冊。`;
    const photoKey = page && !page.blockedAt ? (page.photos[0]?.storageKey ?? null) : null;
    return { title, description, url: `${this.config.publicBaseUrl}/d/${code}`, card: null, square: { kind: 'driver', name: name || '司機', photoKey } };
  }

  /** The whole stored photo, fitted inside a picture's photo space (never cut), as a data: URL the SVG can draw. */
  private async photo(key: string, width: number, height: number): Promise<string | null> {
    const bytes = await this.storage.read(key).catch(() => null);
    if (!bytes) return null;
    try {
      const jpeg = await sharp(bytes).rotate().resize(width, height, { fit: 'inside' }).jpeg({ quality: 85 }).toBuffer();
      return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
    } catch {
      return null;
    }
  }
}
