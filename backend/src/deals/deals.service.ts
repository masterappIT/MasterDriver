import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DEAL_CLASH_HOURS, DEAL_MAX_WINDOW_HOURS, type DealBookingCreate, type DealCreate, type DealUpdate } from '@masterdriver/shared';
import { Prisma, type BookingStatus, type DealStatus } from '../../generated/prisma';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomCode } from '../common/crypto';
import { apiError } from '../common/errors';
import { readLimits } from '../common/limits';
import { NotificationsService } from '../notifications/notifications.service';
import { telemetry } from '../observability/telemetry';
import { PrismaService } from '../prisma.service';
import { ProfilePagesService } from '../profile-pages/profile-pages.service';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';
import { ACTIVE, WAITING, lockDeal, takeDown } from './deal-hold';
import { dealShareText } from './deal-share-text';

const CODE_LENGTH = 10;
const BOOKING_CODE_LENGTH = 16;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LIST_LIMIT = 50;

const toMinor = (amount: number) => Math.round(amount * 100);
/** The driver's own trips and the 特價車 bookings waiting on them, to flag bookings close in time. */
type Clashes = { trips: Date[]; waiting: { id: string; pickupAt: Date }[] };
const NO_CLASHES: Clashes = { trips: [], waiting: [] };
const money = (minor: number | null, currency: string) => (minor === null ? null : { amount: minor / 100, currency });

/** The driver's car, as a deal's passengers see it; no phone until the driver has their booking. */
const driverSelect = {
  select: {
    id: true,
    profile: true,
    profilePage: { select: { code: true, published: true, blockedAt: true, photos: { select: { id: true, storageKey: true }, orderBy: { createdAt: 'desc' }, take: 1 } } },
  },
} as const;

const dealInclude = {
  driver: driverSelect,
  bookings: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, status: true, pickupAt: true, passengers: true, luggage: true, passengerName: true, driverUnread: true, orderId: true, createdAt: true },
  },
} satisfies Prisma.DealInclude;
type DealRow = Prisma.DealGetPayload<{ include: typeof dealInclude }>;

/** The last time a deal can leave: the end of its 時段, or its pickup time. */
const lastPickup = (deal: { pickupAt: Date; pickupUntil: Date | null }) => deal.pickupUntil ?? deal.pickupAt;
const isActive = (booking: { status: BookingStatus }) => ACTIVE.includes(booking.status);

/**
 * What a deal shows as. An open one reads EXPIRED once its last pickup time has passed, and FULL
 * while 最多接幾組 parties hold a booking (one cancelled or declined frees its place).
 */
export type DealState = DealStatus | 'FULL' | 'EXPIRED';
export function dealState(deal: { status: DealStatus; pickupAt: Date; pickupUntil: Date | null; maxBookings: number | null }, active: number, now: Date): DealState {
  if (deal.status !== 'OPEN') return deal.status;
  if (lastPickup(deal) <= now) return 'EXPIRED';
  return deal.maxBookings !== null && active >= deal.maxBookings ? 'FULL' : 'OPEN';
}

/**
 * 特價車: a driver offers a trip at their own price, whole car, for each party, and sends its link
 * to passengers themselves. Like a product, any number of parties book it without an account,
 * each at its own time in the deal's 時段, until the driver closes it or 最多接幾組 is reached.
 * Each booking is a 名片頁 request (BookingRequest with dealId) at the deal's price, so the driver
 * answers it in 等我報價 and makes it its own order the usual way: drives it, or puts it out to
 * the group. The platform never lists, recommends or prices a deal.
 */
@Injectable()
export class DealsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ProfilePagesService) private readonly pages: ProfilePagesService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------ the driver

  async create(userId: string, input: DealCreate, now = new Date()) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { userId: true } });
    if (!profile) throw apiError(HttpStatus.CONFLICT, 'PROFILE_REQUIRED', 'Fill in your driver details first');
    const pickupAt = new Date(input.pickupAt);
    const pickupUntil = input.pickupUntil ? new Date(input.pickupUntil) : null;
    this.checkTimes(pickupAt, pickupUntil, now);
    // Its bookings are kept under the driver's 名片頁, made unpublished if they have none.
    await this.pages.ensurePage(userId);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const deal = await this.prisma.deal.create({
          data: {
            code: randomCode(CODE_LENGTH),
            driverId: userId,
            pickupAt,
            pickupUntil,
            origin: input.origin,
            destination: input.destination,
            priceMinor: toMinor(input.price),
            currency: input.currency,
            originalPriceMinor: input.originalPrice === undefined ? null : toMinor(input.originalPrice),
            maxPassengers: input.maxPassengers ?? null,
            maxLuggage: input.maxLuggage ?? null,
            notes: input.notes ?? null,
            maxBookings: input.maxBookings ?? null,
            autoAccept: input.autoAccept,
            createdAt: now,
          },
          include: dealInclude,
        });
        telemetry.domain('deal.create');
        return this.driverView(deal, now, NO_CLASHES);
      } catch (error) {
        const collided = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!collided || attempt >= 2) throw error;
      }
    }
  }

  async list(userId: string, now = new Date()) {
    const rows = await this.prisma.deal.findMany({ where: { driverId: userId, deletedAt: null }, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT, include: dealInclude });
    const clashes = await this.clashes(userId, now);
    return rows.map((row) => this.driverView(row, now, clashes));
  }

  async get(userId: string, id: string, now = new Date()) {
    const deal = await this.prisma.deal.findFirst({ where: { id, driverId: userId, deletedAt: null }, include: dealInclude });
    if (!deal) throw this.notFound();
    return this.driverView(deal, now, await this.clashes(userId, now));
  }

  /** Changes while it takes bookings. Bookings already sent keep their own time and price. */
  async update(userId: string, id: string, input: DealUpdate, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.deal.findFirst({ where: { id, driverId: userId, deletedAt: null }, select: { id: true } });
      if (!found) throw this.notFound();
      const deal = await lockDeal(tx, id);
      if (deal.status !== 'OPEN' || lastPickup(deal) <= now) throw this.notOpen();
      if (input.maxBookings) {
        const active = await tx.bookingRequest.count({ where: { dealId: id, status: { in: ACTIVE } } });
        if (input.maxBookings < active) {
          throw apiError(HttpStatus.CONFLICT, 'DEAL_MAX_BELOW_BOOKED', 'Fewer places than parties already booked', { booked: active });
        }
      }
      const pickupAt = input.pickupAt ? new Date(input.pickupAt) : deal.pickupAt;
      const pickupUntil = input.pickupUntil === undefined ? deal.pickupUntil : input.pickupUntil ? new Date(input.pickupUntil) : null;
      if (input.pickupAt !== undefined || input.pickupUntil !== undefined) this.checkTimes(pickupAt, pickupUntil, now);
      const priceMinor = input.price === undefined ? deal.priceMinor : toMinor(input.price);
      const originalPriceMinor =
        input.originalPrice === undefined ? deal.originalPriceMinor : input.originalPrice === null ? null : toMinor(input.originalPrice);
      if (originalPriceMinor !== null && originalPriceMinor <= priceMinor) {
        throw apiError(HttpStatus.BAD_REQUEST, 'DEAL_ORIGINAL_NOT_ABOVE', 'The original price must be above the deal price');
      }
      await tx.deal.update({
        where: { id },
        data: {
          pickupAt,
          pickupUntil,
          priceMinor,
          originalPriceMinor,
          ...(input.currency !== undefined ? { currency: input.currency } : {}),
          ...(input.origin !== undefined ? { origin: input.origin } : {}),
          ...(input.destination !== undefined ? { destination: input.destination } : {}),
          ...(input.maxPassengers !== undefined ? { maxPassengers: input.maxPassengers } : {}),
          ...(input.maxLuggage !== undefined ? { maxLuggage: input.maxLuggage } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          ...(input.maxBookings !== undefined ? { maxBookings: input.maxBookings } : {}),
          ...(input.autoAccept !== undefined ? { autoAccept: input.autoAccept } : {}),
        },
      });
    });
    return this.get(userId, id, now);
  }

  /** 關閉: no new bookings. The ones already sent stay, for the driver to make orders of or decline. */
  async close(userId: string, id: string, now = new Date()) {
    const closed = await this.prisma.deal.updateMany({ where: { id, driverId: userId, deletedAt: null, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: now } });
    if (closed.count === 0) {
      if ((await this.prisma.deal.count({ where: { id, driverId: userId, deletedAt: null } })) === 0) throw this.notFound();
      throw this.notOpen();
    }
    telemetry.domain('deal.close');
    return this.get(userId, id, now);
  }

  /**
   * 刪除 (2026-10-22): a deal the driver no longer wants. It leaves their list, its link opens on
   * 「找不到這個特價車」, and the parties still waiting are declined. Orders made from it stay as they
   * are. The row is kept, marked, so those bookings and orders still say they came from a 特價車.
   */
  async remove(userId: string, id: string, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.deal.findFirst({ where: { id, driverId: userId, deletedAt: null }, select: { id: true } });
      if (!found) throw this.notFound();
      const deal = await lockDeal(tx, id);
      await tx.deal.update({
        where: { id },
        data: { deletedAt: now, ...(deal.status === 'OPEN' ? { status: 'CLOSED', closedAt: now } : {}) },
      });
      await tx.bookingRequest.updateMany({ where: { dealId: id, orderId: null, status: { in: WAITING } }, data: { status: 'DECLINED' } });
    });
    telemetry.domain('deal.delete');
    return { deleted: true };
  }

  // ------------------------------------------------- the platform's staff

  /** A user's deals, newest first, for the admin's user details. */
  async staffList(userId: string, now = new Date()) {
    const rows = await this.prisma.deal.findMany({ where: { driverId: userId }, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT, include: dealInclude });
    return rows.map((row) => ({
      id: row.id,
      url: this.url(row.code),
      state: dealState(row, row.bookings.filter(isActive).length, now),
      pickupAt: row.pickupAt.toISOString(),
      pickupUntil: row.pickupUntil?.toISOString() ?? null,
      origin: row.origin,
      destination: row.destination,
      price: money(row.priceMinor, row.currency),
      originalPrice: money(row.originalPriceMinor, row.currency),
      bookings: row.bookings.length,
      ordered: row.bookings.filter((booking) => booking.status === 'ORDERED').length,
      maxBookings: row.maxBookings,
      staffReason: row.staffReason,
      /** 刪除 by the driver: still listed here, for complaints about it. */
      deletedAt: row.deletedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** 下架 after a complaint; the reason is shown to the driver. */
  async staffCancel(userId: string, id: string, reason: string, now = new Date()) {
    const found = await this.prisma.deal.findFirst({ where: { id, driverId: userId, deletedAt: null }, select: { id: true } });
    if (!found) throw this.notFound();
    await this.prisma.$transaction((tx) => takeDown(tx, id, now, reason));
  }

  // ----------------------------------------------------------- the public

  async publicDeal(code: string, now = new Date()) {
    const deal = await this.prisma.deal.findUnique({ where: { code }, include: dealInclude });
    if (!deal || deal.deletedAt) throw this.notFound();
    return { code: deal.code, ...this.tripFields(deal, now), autoAccept: deal.autoAccept, driver: await this.carOf(deal) };
  }

  /** The driver's car photo on the deal's link, while it is up. */
  async photo(code: string, photoId: string) {
    const deal = await this.prisma.deal.findUnique({ where: { code }, select: { driverId: true, status: true, deletedAt: true } });
    const photo =
      deal && deal.status !== 'CANCELLED' && !deal.deletedAt
        ? await this.prisma.profilePhoto.findFirst({ where: { id: photoId, page: { userId: deal.driverId, blockedAt: null } } })
        : null;
    const bytes = photo ? await this.storage.read(photo.storageKey) : null;
    if (!photo || !bytes) throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'Photo not found');
    return { mime: photo.mimeType, bytes };
  }

  /**
   * A passenger books the deal. It becomes a request in the driver's 等我報價 at the deal's price;
   * with 自動接受 it is accepted at once. The passenger follows it on /b/{code}.
   */
  async createBooking(code: string, input: DealBookingCreate, ip: string | undefined, now = new Date()) {
    const found = await this.prisma.deal.findUnique({ where: { code }, select: { id: true, driverId: true, deletedAt: true } });
    if (!found || found.deletedAt) throw this.notFound();
    const page = await this.pages.ensurePage(found.driverId);
    // Limits of their own, apart from 名片頁 requests (2026-10-22): mostly by the passenger's phone,
    // as on mainland mobile networks many passengers share one address.
    const limits = await readLimits(this.prisma);
    const since = { gte: new Date(now.getTime() - DAY_MS) };
    const [fromPhone, fromAddress, forDriver] = await Promise.all([
      this.prisma.bookingRequest.count({ where: { dealId: { not: null }, passengerContact: input.passengerContact, createdAt: since } }),
      ip ? this.prisma.bookingRequest.count({ where: { dealId: { not: null }, ip, createdAt: since } }) : 0,
      this.prisma.bookingRequest.count({ where: { deal: { driverId: found.driverId }, createdAt: since } }),
    ]);
    if (fromPhone >= limits.dealBookingPerPhonePerDay) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'DEAL_PHONE_LIMIT', 'This phone has booked enough deals today');
    }
    if (fromAddress >= limits.dealBookingPerIpPerDay) throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'BOOKING_LIMIT', 'Too many booking requests from this address today');
    if (forDriver >= limits.dealBookingPerDriverPerDay) throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'BOOKING_PAGE_FULL', 'This driver has received their bookings for today');

    const { booking, deal } = await this.prisma.$transaction(async (tx) => {
      const deal = await lockDeal(tx, found.id);
      const active = await tx.bookingRequest.count({ where: { dealId: deal.id, status: { in: ACTIVE } } });
      const state = dealState(deal, active, now);
      if (state === 'FULL') throw apiError(HttpStatus.CONFLICT, 'DEAL_FULL', 'This deal has all the bookings it takes');
      if (state !== 'OPEN') throw this.notOpen();
      // Without a 時段 the deal's own time stands, whatever the page sent.
      const pickupAt = deal.pickupUntil ? new Date(input.pickupAt) : deal.pickupAt;
      if (deal.pickupUntil && (pickupAt < deal.pickupAt || pickupAt > deal.pickupUntil)) {
        throw apiError(HttpStatus.BAD_REQUEST, 'DEAL_TIME_OUTSIDE', 'Choose a time within the deal’s hours');
      }
      if (pickupAt <= now) throw apiError(HttpStatus.BAD_REQUEST, 'BOOKING_IN_THE_PAST', 'Choose a time in the future');
      if (deal.maxPassengers !== null && input.passengers > deal.maxPassengers) {
        throw apiError(HttpStatus.BAD_REQUEST, 'DEAL_TOO_MANY_PASSENGERS', 'More passengers than this deal takes', { max: deal.maxPassengers });
      }
      if (deal.maxLuggage !== null && input.luggage > deal.maxLuggage) {
        throw apiError(HttpStatus.BAD_REQUEST, 'DEAL_TOO_MUCH_LUGGAGE', 'More luggage than this deal takes', { max: deal.maxLuggage });
      }
      // The same passenger may book it again for another time, not twice for the same one.
      const twice = await tx.bookingRequest.count({
        where: { dealId: deal.id, passengerContact: input.passengerContact, pickupAt, status: { in: ACTIVE } },
      });
      if (twice > 0) throw apiError(HttpStatus.CONFLICT, 'DEAL_ALREADY_BOOKED', 'This phone already booked this deal for this time');
      const booking = await tx.bookingRequest.create({
        data: {
          pageId: page.id,
          dealId: deal.id,
          code: randomCode(BOOKING_CODE_LENGTH),
          status: deal.autoAccept ? 'ACCEPTED' : 'PENDING',
          pickupAt,
          origin: input.origin ?? deal.origin,
          destination: input.destination ?? deal.destination,
          passengers: input.passengers,
          luggage: input.luggage,
          passengerName: input.passengerName,
          passengerContact: input.passengerContact,
          passengerWechat: input.passengerWechat ?? null,
          notes: input.notes,
          // The deal's price is what the passenger booked at; it is not quoted again.
          quoteMinor: deal.priceMinor,
          quoteCurrency: deal.currency,
          quotedAt: now,
          source: input.source,
          ip: ip ?? null,
          createdAt: now,
        },
        select: { id: true, code: true, origin: true, destination: true, pickupAt: true },
      });
      return { booking, deal };
    });
    await this.notifications.send({ userId: deal.driverId, kind: deal.autoAccept ? 'DEAL_BOOKING_ACCEPTED' : 'DEAL_BOOKING_NEW', group: 'BOOKINGS', booking });
    telemetry.domain('deal.booking');
    return { code: booking.code, url: `${this.config.publicBaseUrl}/b/${booking.code}` };
  }

  // --------------------------------------------------------------- internals

  url(code: string) {
    return `${this.config.publicBaseUrl}/d/${code}`;
  }

  private checkTimes(pickupAt: Date, pickupUntil: Date | null, now: Date) {
    if (lastPickup({ pickupAt, pickupUntil }) <= now) throw apiError(HttpStatus.BAD_REQUEST, 'DEAL_IN_THE_PAST', 'Choose a time in the future');
    if (pickupUntil && (pickupUntil <= pickupAt || pickupUntil.getTime() - pickupAt.getTime() > DEAL_MAX_WINDOW_HOURS * HOUR_MS)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'DEAL_WINDOW_INVALID', 'The hours must end after they start, within a day');
    }
  }

  /** What both the driver and the passenger see of the trip and the price. */
  private tripFields(deal: DealRow, now: Date) {
    return {
      state: dealState(deal, deal.bookings.filter(isActive).length, now),
      pickupAt: deal.pickupAt.toISOString(),
      pickupUntil: deal.pickupUntil?.toISOString() ?? null,
      origin: deal.origin,
      destination: deal.destination,
      price: money(deal.priceMinor, deal.currency)!,
      originalPrice: money(deal.originalPriceMinor, deal.currency),
      maxPassengers: deal.maxPassengers,
      maxLuggage: deal.maxLuggage,
      notes: deal.notes,
    };
  }

  /** The car a passenger looks for. Plates follow the driver's choice to keep them from passengers. */
  private async carOf(deal: DealRow) {
    const profile = deal.driver.profile;
    const hide = profile?.hidePlates ?? false;
    const page = deal.driver.profilePage && !deal.driver.profilePage.blockedAt ? deal.driver.profilePage : null;
    return {
      name: profile?.name ?? null,
      vehicleType: profile?.vehicleType ?? null,
      seats: profile?.seats ?? null,
      color: profile?.color ?? null,
      plateType: profile?.plateType ?? null,
      platesHidden: hide,
      hkPlate: hide ? null : (profile?.hkPlate ?? null),
      macauPlate: hide ? null : (profile?.macauPlate ?? null),
      mainlandPlate: hide ? null : (profile?.mainlandPlate ?? null),
      // Counted like the 名片頁 figure: trips this driver took and finished in the tool.
      completedTrips: await this.prisma.order.count({ where: { claimedById: deal.driverId, status: 'COMPLETED' } }),
      photos: page?.photos.map((photo) => `/api/public/deals/${deal.code}/photos/${photo.id}`) ?? [],
      pageCode: page?.published ? page.code : null,
      phones: [] as string[],
      wechatId: null,
      whatsapp: null,
    };
  }

  private driverView(deal: DealRow, now: Date, clashes: Clashes) {
    const url = this.url(deal.code);
    const profile = deal.driver.profile;
    const page = deal.driver.profilePage && !deal.driver.profilePage.blockedAt ? deal.driver.profilePage : null;
    return {
      id: deal.id,
      code: deal.code,
      url,
      ...this.tripFields(deal, now),
      autoAccept: deal.autoAccept,
      maxBookings: deal.maxBookings,
      closedAt: deal.closedAt?.toISOString() ?? null,
      cancelledAt: deal.cancelledAt?.toISOString() ?? null,
      staffReason: deal.staffReason,
      createdAt: deal.createdAt.toISOString(),
      /** Bookings waiting for the driver to accept; booked ones (自動接受) waiting for their order; orders made. */
      waiting: deal.bookings.filter((booking) => booking.status === 'PENDING').length,
      toOrder: deal.bookings.filter((booking) => booking.status === 'ACCEPTED').length,
      ordered: deal.bookings.filter((booking) => booking.status === 'ORDERED').length,
      /** Places left under 最多接幾組; null: no limit. */
      left: deal.maxBookings === null ? null : Math.max(0, deal.maxBookings - deal.bookings.filter(isActive).length),
      unread: deal.bookings.some((booking) => booking.driverUnread && (booking.status === 'PENDING' || booking.status === 'ACCEPTED')),
      bookings: deal.bookings.map((booking) => ({
        id: booking.id,
        status: booking.status,
        pickupAt: booking.pickupAt.toISOString(),
        passengers: booking.passengers,
        luggage: booking.luggage,
        passengerName: booking.passengerName,
        unread: booking.driverUnread,
        orderId: booking.orderId,
        createdAt: booking.createdAt.toISOString(),
        /** 時間相近: close to another trip or waiting booking of the driver's. */
        clash: this.clashing(booking, clashes),
      })),
      // For the 分享圖: the car and its photo, drawn on the driver's phone.
      car: {
        name: profile?.name ?? null,
        vehicleType: profile?.vehicleType ?? null,
        seats: profile?.seats ?? null,
        photoUrl: page?.photos[0] ? `/api/public/deals/${deal.code}/photos/${page.photos[0].id}` : null,
      },
      share: dealShareText(deal, { name: profile?.name ?? null, vehicleType: profile?.vehicleType ?? null, seats: profile?.seats ?? null }, url),
    };
  }

  /** What a waiting booking may clash with: the driver's trips still ahead, and the bookings waiting on them. */
  private async clashes(driverId: string, now: Date): Promise<Clashes> {
    const ahead = { gte: new Date(now.getTime() - DEAL_CLASH_HOURS * HOUR_MS) };
    const [orders, waiting] = await Promise.all([
      this.prisma.order.findMany({ where: { claimedById: driverId, status: 'ASSIGNED', pickupAt: ahead }, select: { pickupAt: true } }),
      this.prisma.bookingRequest.findMany({
        where: { deal: { driverId }, status: { in: ['PENDING', 'ACCEPTED'] }, pickupAt: ahead },
        select: { id: true, pickupAt: true },
      }),
    ]);
    return { trips: orders.map((order) => order.pickupAt), waiting };
  }

  /** 時間相近: a booking still waiting on the driver within DEAL_CLASH_HOURS of their own trip or another waiting booking. */
  private clashing(booking: { id: string; status: BookingStatus; pickupAt: Date }, clashes: Clashes) {
    if (booking.status !== 'PENDING' && booking.status !== 'ACCEPTED') return false;
    const close = (at: Date) => Math.abs(at.getTime() - booking.pickupAt.getTime()) <= DEAL_CLASH_HOURS * HOUR_MS;
    return clashes.trips.some(close) || clashes.waiting.some((other) => other.id !== booking.id && close(other.pickupAt));
  }

  private notFound() {
    return apiError(HttpStatus.NOT_FOUND, 'DEAL_NOT_FOUND', 'Deal not found');
  }

  private notOpen() {
    return apiError(HttpStatus.CONFLICT, 'DEAL_NOT_OPEN', 'This deal takes no more bookings');
  }
}
