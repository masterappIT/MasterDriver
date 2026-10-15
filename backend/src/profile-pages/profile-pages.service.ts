import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { PROFILE_PHOTO_MAX, PROFILE_PHOTO_MAX_BYTES, type BookingCreate, type BookingQuote, type ProfilePageUpdate } from '@masterdriver/shared';
import { Prisma, type BookingStatus } from '../../generated/prisma';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomCode } from '../common/crypto';
import { apiError } from '../common/errors';
import { readLimits } from '../common/limits';
import { NotificationsService } from '../notifications/notifications.service';
import { telemetry } from '../observability/telemetry';
import { phonesOf } from '../orders/order-view';
import { PrismaService } from '../prisma.service';
import { profileShareText } from './profile-share-text';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';
import { sniffMedia } from '../support/media-file';

const PAGE_CODE_LENGTH = 8;
const BOOKING_CODE_LENGTH = 16;
const DAY_MS = 24 * 60 * 60 * 1000;
const LIST_LIMIT = 100;
/** A request stays open to the passenger's and the driver's actions in these states. */
const OPEN: BookingStatus[] = ['PENDING', 'QUOTED', 'ACCEPTED'];

const pageInclude = {
  photos: { orderBy: { createdAt: 'asc' } },
  user: {
    select: {
      countryCode: true,
      phone: true,
      profile: { select: { name: true, vehicleType: true, seats: true, color: true, plateType: true, hkMacauPhone: true, mainlandPhone: true } },
    },
  },
} satisfies Prisma.ProfilePageInclude;
type PageRow = Prisma.ProfilePageGetPayload<{ include: typeof pageInclude }>;
type BookingRow = Prisma.BookingRequestGetPayload<{ include: { order: { select: { id: true; confirmCode: true } } } }>;

const money = (minor: number | null, currency: string) => (minor === null ? null : { amount: minor / 100, currency });

/**
 * 名片頁: a driver's own public page, and the booking requests passengers
 * send from it. The platform shows the page to whoever has its link, and
 * passes requests and answers between the two; the price and the trip are
 * theirs to agree.
 */
@Injectable()
export class ProfilePagesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  // ------------------------------------------------------------ the owner

  /** The user's page, made (unpublished) the first time they open the editor. */
  async mine(userId: string) {
    return this.ownerView(await this.findOrCreate(userId));
  }

  async update(userId: string, input: ProfilePageUpdate) {
    const page = await this.findOrCreate(userId);
    if (input.published && !page.user.profile) {
      throw apiError(HttpStatus.CONFLICT, 'PROFILE_REQUIRED', 'Fill in your driver details before publishing the page');
    }
    if (input.published && page.blockedAt) {
      throw apiError(HttpStatus.CONFLICT, 'PROFILE_PAGE_BLOCKED', 'The platform took this page down; contact support');
    }
    return this.ownerView(await this.prisma.profilePage.update({ where: { id: page.id }, data: input, include: pageInclude }));
  }

  /** A vehicle photo: a real picture, within the size limit, at most a few per page. */
  async addPhoto(userId: string, bytes: Buffer) {
    const page = await this.findOrCreate(userId);
    const type = sniffMedia(bytes);
    if (!type || type.kind !== 'IMAGE') throw apiError(HttpStatus.UNSUPPORTED_MEDIA_TYPE, 'PHOTO_TYPE', 'Only PNG, JPEG and WebP pictures are accepted');
    if (bytes.length > PROFILE_PHOTO_MAX_BYTES) throw apiError(HttpStatus.PAYLOAD_TOO_LARGE, 'PHOTO_TOO_LARGE', 'The picture is too large');
    if (!this.storage.available) throw apiError(HttpStatus.SERVICE_UNAVAILABLE, 'SUPPORT_MEDIA_UNAVAILABLE', 'Media storage is not configured');
    if (page.photos.length >= PROFILE_PHOTO_MAX) throw apiError(HttpStatus.CONFLICT, 'PHOTO_LIMIT', `At most ${PROFILE_PHOTO_MAX} photos`);

    const id = randomCode(24);
    const storageKey = `profile/${page.id}/${id}.${type.extension}`;
    await this.storage.put(storageKey, bytes, type.mime);
    try {
      await this.prisma.profilePhoto.create({ data: { id, pageId: page.id, storageKey, mimeType: type.mime, sizeBytes: bytes.length } });
    } catch (error) {
      await this.storage.remove(storageKey).catch(() => undefined);
      throw error;
    }
    return this.mine(userId);
  }

  async removePhoto(userId: string, photoId: string) {
    const photo = await this.prisma.profilePhoto.findFirst({ where: { id: photoId, page: { userId } } });
    if (!photo) throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'Photo not found');
    await this.prisma.profilePhoto.delete({ where: { id: photo.id } });
    await this.storage.remove(photo.storageKey);
    return this.mine(userId);
  }

  /** The owner previews their own photos before publishing; everyone else needs the page to be published. */
  async photo(code: string, photoId: string, viewerId?: string) {
    const photo = await this.prisma.profilePhoto.findFirst({
      where: { id: photoId, page: { code, OR: [{ published: true }, ...(viewerId ? [{ userId: viewerId }] : [])] } },
    });
    const bytes = photo ? await this.storage.read(photo.storageKey) : null;
    if (!photo || !bytes) throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'Photo not found');
    return { mime: photo.mimeType, bytes };
  }

  /**
   * A vehicle photo for a passenger's confirmation link: of a driver who has that order, or a
   * leg of its trip, and only while that leg is on. The page need not be published.
   */
  async passengerPhoto(confirmCode: string, photoId: string) {
    const order = await this.prisma.order.findUnique({
      where: { confirmCode },
      select: {
        status: true,
        claimedById: true,
        journeyHead: { select: { journeyLegs: { select: { status: true, claimedById: true } } } },
      },
    });
    const drivers = (order?.journeyHead?.journeyLegs ?? (order ? [order] : []))
      .filter((leg) => leg.status === 'ASSIGNED' || leg.status === 'COMPLETED')
      .map((leg) => leg.claimedById)
      .filter((id): id is string => id !== null);
    const photo = drivers.length
      ? await this.prisma.profilePhoto.findFirst({ where: { id: photoId, page: { userId: { in: drivers }, blockedAt: null } } })
      : null;
    const bytes = photo ? await this.storage.read(photo.storageKey) : null;
    if (!photo || !bytes) throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'Photo not found');
    return { mime: photo.mimeType, bytes };
  }

  // ------------------------------------------------- the platform's staff

  /**
   * 下架 after a complaint: the page stops being public and its owner cannot publish it again
   * until staff restore it. Restoring leaves it unpublished; the owner publishes it themselves.
   */
  async staffBlock(userId: string, reason: string, now = new Date()) {
    const blocked = await this.prisma.profilePage.updateMany({
      where: { userId, blockedAt: null },
      data: { published: false, blockedAt: now, blockedReason: reason },
    });
    if (blocked.count === 0) throw apiError(HttpStatus.CONFLICT, 'PROFILE_PAGE_NOT_BLOCKABLE', 'No page, or it is already taken down');
  }

  async staffRestore(userId: string) {
    const restored = await this.prisma.profilePage.updateMany({ where: { userId, blockedAt: { not: null } }, data: { blockedAt: null, blockedReason: null } });
    if (restored.count === 0) throw apiError(HttpStatus.CONFLICT, 'PROFILE_PAGE_NOT_BLOCKED', 'The page is not taken down');
  }

  /** Any photo of the user's page, whether published or not, for staff looking into a complaint. */
  async staffPhoto(userId: string, photoId: string) {
    const photo = await this.prisma.profilePhoto.findFirst({ where: { id: photoId, page: { userId } } });
    const bytes = photo ? await this.storage.read(photo.storageKey) : null;
    if (!photo || !bytes) throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'Photo not found');
    return { mime: photo.mimeType, bytes };
  }

  async staffRemovePhoto(userId: string, photoId: string) {
    await this.removePhoto(userId, photoId);
  }

  // ----------------------------------------------------------- the public

  async publicPage(code: string, viewerId?: string) {
    const page = await this.prisma.profilePage.findUnique({ where: { code }, include: pageInclude });
    if (!page || (!page.published && page.userId !== viewerId)) throw this.pageNotFound();
    const view = await this.view(page);
    // A page from when several photos were allowed shows its newest; the owner removes the rest in their settings.
    return { ...view, photos: view.photos.slice(-PROFILE_PHOTO_MAX), published: page.published, mine: page.userId === viewerId };
  }

  async createBooking(code: string, input: BookingCreate, ip: string | undefined, now = new Date()) {
    const page = await this.prisma.profilePage.findUnique({ where: { code }, select: { id: true, userId: true, published: true } });
    if (!page?.published) throw this.pageNotFound();
    const pickupAt = new Date(input.pickupAt);
    if (pickupAt <= now) throw apiError(HttpStatus.BAD_REQUEST, 'BOOKING_IN_THE_PAST', 'Choose a time in the future');

    const limits = await readLimits(this.prisma);
    const since = new Date(now.getTime() - DAY_MS);
    const [fromAddress, onPage] = await Promise.all([
      ip ? this.prisma.bookingRequest.count({ where: { ip, createdAt: { gte: since } } }) : 0,
      this.prisma.bookingRequest.count({ where: { pageId: page.id, createdAt: { gte: since } } }),
    ]);
    if (fromAddress >= limits.bookingPerIpPerDay) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'BOOKING_LIMIT', 'Too many booking requests from this address today');
    }
    if (onPage >= limits.bookingPerPagePerDay) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'BOOKING_PAGE_FULL', 'This page has received its bookings for today');
    }

    const booking = await this.prisma.bookingRequest.create({
      data: {
        pageId: page.id,
        code: randomCode(BOOKING_CODE_LENGTH),
        pickupAt,
        origin: input.origin,
        destination: input.destination,
        passengers: input.passengers,
        luggage: input.luggage,
        transfer: input.transfer,
        passengerName: input.passengerName,
        passengerContact: input.passengerContact,
        passengerWechat: input.passengerWechat ?? null,
        notes: input.notes,
        source: input.source,
        ip: ip ?? null,
        createdAt: now,
      },
      select: { id: true, code: true, origin: true, destination: true, pickupAt: true },
    });
    await this.notifications.send({ userId: page.userId, kind: 'BOOKING_NEW', group: 'BOOKINGS', booking });
    telemetry.domain('booking.create');
    return { code: booking.code, url: `${this.config.publicBaseUrl}/b/${booking.code}` };
  }

  /** What the passenger sees behind their own link: the request, the driver's answer, and where to go next. */
  async passengerBooking(code: string) {
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { code },
      include: { order: { select: { id: true, confirmCode: true } }, page: { include: pageInclude } },
    });
    if (!booking) throw this.bookingNotFound();
    return {
      ...this.bookingFields(booking),
      driverName: booking.page.user.profile?.name ?? null,
      pageCode: booking.page.published ? booking.page.code : null,
      // Once it is an order, the passenger continues on that order's confirmation page.
      confirmUrl: booking.order ? `/c/${booking.order.confirmCode}` : null,
    };
  }

  async passengerAccept(code: string) {
    return this.passengerMove(code, ['QUOTED'], 'ACCEPTED');
  }

  async passengerCancel(code: string) {
    return this.passengerMove(code, OPEN, 'CANCELLED');
  }

  // ------------------------------------------------- the driver's bookings

  async unread(userId: string) {
    return { count: await this.prisma.bookingRequest.count({ where: { page: { userId }, driverUnread: true } }) };
  }

  async bookings(userId: string) {
    const rows = await this.prisma.bookingRequest.findMany({
      where: { page: { userId } },
      orderBy: { createdAt: 'desc' },
      take: LIST_LIMIT,
      include: { order: { select: { id: true, confirmCode: true } } },
    });
    return rows.map((row) => this.driverView(row));
  }

  /** Opening a request marks it read. */
  async booking(userId: string, id: string) {
    const row = await this.ownBooking(userId, id);
    if (row.driverUnread) await this.prisma.bookingRequest.update({ where: { id }, data: { driverUnread: false } });
    return this.driverView({ ...row, driverUnread: false });
  }

  /**
   * A quote can be sent again with another price until the passenger agrees to one; after that
   * the agreed price stands (2026-10-14).
   */
  async quote(userId: string, id: string, input: BookingQuote, now = new Date()) {
    return this.driverMove(userId, id, ['PENDING', 'QUOTED'], {
      status: 'QUOTED',
      quoteMinor: Math.round(input.amount * 100),
      quoteCurrency: input.currency,
      quoteNote: input.note ?? null,
      quotedAt: now,
    });
  }

  async decline(userId: string, id: string) {
    return this.driverMove(userId, id, OPEN, { status: 'DECLINED' });
  }

  // --------------------------------------------------------------- internals

  private async findOrCreate(userId: string): Promise<PageRow> {
    const found = await this.prisma.profilePage.findUnique({ where: { userId }, include: pageInclude });
    if (found) return found;
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.prisma.profilePage.create({ data: { userId, code: randomCode(PAGE_CODE_LENGTH) }, include: pageInclude });
      } catch (error) {
        const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!duplicate || attempt >= 2) throw error;
        // Either the code collided, or the page was made by a request that arrived at the same time.
        const made = await this.prisma.profilePage.findUnique({ where: { userId }, include: pageInclude });
        if (made) return made;
      }
    }
  }

  /** Trips this driver took and finished in the tool; it cannot be typed in. */
  private completedTrips(userId: string) {
    return this.prisma.order.count({ where: { claimedById: userId, status: 'COMPLETED' } });
  }

  private async view(page: PageRow) {
    const profile = page.user.profile;
    return {
      code: page.code,
      name: profile?.name ?? null,
      vehicleType: profile?.vehicleType ?? null,
      seats: profile?.seats ?? null,
      color: profile?.color ?? null,
      plateType: profile?.plateType ?? null,
      intro: page.intro,
      routes: page.routes,
      languages: page.languages,
      regions: page.regions,
      // The driver's numbers on both sides of the border, so a passenger can call from either.
      phones: phonesOf(page.user),
      wechatId: page.wechatId || null,
      whatsapp: page.whatsapp || null,
      photos: page.photos.map((photo) => ({ id: photo.id, url: `/api/public/profiles/${page.code}/photos/${photo.id}` })),
      completedTrips: await this.completedTrips(page.userId),
    };
  }

  /** The address passengers open a 名片頁 at: what the driver shares, and what the admin opens. */
  pageUrl(code: string): string {
    return `${this.config.publicBaseUrl}/p/${code}`;
  }

  private async ownerView(page: PageRow) {
    const view = await this.view(page);
    const url = this.pageUrl(page.code);
    return {
      ...view,
      published: page.published,
      /** 下架 by the platform after a complaint, with the reason the owner is shown. */
      blocked: page.blockedAt ? { at: page.blockedAt.toISOString(), reason: page.blockedReason ?? '' } : null,
      hasDriverProfile: Boolean(page.user.profile),
      url,
      /** What the driver pastes to share the page: a few lines about them, then the link. */
      shareText: profileShareText(view, url),
      photoLimit: PROFILE_PHOTO_MAX,
      photosAvailable: this.storage.available,
    };
  }

  private bookingFields(row: Omit<BookingRow, 'order'>) {
    return {
      code: row.code,
      status: row.status,
      pickupAt: row.pickupAt.toISOString(),
      origin: row.origin,
      destination: row.destination,
      passengers: row.passengers,
      luggage: row.luggage,
      transfer: row.transfer,
      passengerName: row.passengerName,
      passengerContact: row.passengerContact,
      passengerWechat: row.passengerWechat,
      notes: row.notes,
      quote: money(row.quoteMinor, row.quoteCurrency),
      quoteNote: row.quoteNote,
      quotedAt: row.quotedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private driverView(row: BookingRow) {
    return { id: row.id, ...this.bookingFields(row), unread: row.driverUnread, source: row.source, orderId: row.order?.id ?? null };
  }

  private async ownBooking(userId: string, id: string) {
    const row = await this.prisma.bookingRequest.findFirst({
      where: { id, page: { userId } },
      include: { order: { select: { id: true, confirmCode: true } } },
    });
    if (!row) throw this.bookingNotFound();
    return row;
  }

  /** The status condition is the arbiter when the passenger and the driver act at the same moment. */
  private async driverMove(userId: string, id: string, from: BookingStatus[], data: Prisma.BookingRequestUncheckedUpdateManyInput) {
    const moved = await this.prisma.bookingRequest.updateMany({
      where: { id, page: { userId }, status: { in: from } },
      data: { ...data, driverUnread: false },
    });
    if (moved.count === 0) {
      await this.ownBooking(userId, id);
      throw this.closed();
    }
    return this.booking(userId, id);
  }

  private async passengerMove(code: string, from: BookingStatus[], status: BookingStatus) {
    const moved = await this.prisma.bookingRequest.updateMany({
      where: { code, status: { in: from } },
      // The driver has something new to look at.
      data: { status, driverUnread: true },
    });
    if (moved.count === 0) {
      if ((await this.prisma.bookingRequest.count({ where: { code } })) === 0) throw this.bookingNotFound();
      throw this.closed();
    }
    const booking = await this.prisma.bookingRequest.findUnique({
      where: { code },
      select: { id: true, origin: true, destination: true, pickupAt: true, page: { select: { userId: true } } },
    });
    if (booking) {
      await this.notifications.send({
        userId: booking.page.userId,
        kind: status === 'ACCEPTED' ? 'BOOKING_ACCEPTED' : 'BOOKING_CANCELLED',
        group: 'BOOKINGS',
        booking,
      });
    }
    return this.passengerBooking(code);
  }

  private pageNotFound() {
    return apiError(HttpStatus.NOT_FOUND, 'PROFILE_PAGE_NOT_FOUND', 'Page not found');
  }

  private bookingNotFound() {
    return apiError(HttpStatus.NOT_FOUND, 'BOOKING_NOT_FOUND', 'Booking request not found');
  }

  private closed() {
    return apiError(HttpStatus.CONFLICT, 'BOOKING_NOT_OPEN', 'The booking request is no longer open');
  }
}
