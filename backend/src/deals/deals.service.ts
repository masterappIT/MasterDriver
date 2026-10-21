import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { DEAL_MAX_WINDOW_HOURS, type DealBookingCreate, type DealCreate, type DealUpdate } from '@masterdriver/shared';
import { Prisma, type DealStatus } from '../../generated/prisma';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomCode } from '../common/crypto';
import { apiError } from '../common/errors';
import { readLimits } from '../common/limits';
import { NotificationsService } from '../notifications/notifications.service';
import { telemetry } from '../observability/telemetry';
import { PrismaService } from '../prisma.service';
import { ProfilePagesService } from '../profile-pages/profile-pages.service';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';
import { HOLDING, lockDeal, takeDown } from './deal-hold';
import { dealShareText } from './deal-share-text';

const CODE_LENGTH = 10;
const BOOKING_CODE_LENGTH = 16;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LIST_LIMIT = 50;

const toMinor = (amount: number) => Math.round(amount * 100);
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

/** What a deal shows as: EXPIRED once its last pickup time has passed with nobody holding it. */
export type DealState = DealStatus | 'EXPIRED';
export function dealState(deal: { status: DealStatus; pickupAt: Date; pickupUntil: Date | null }, now: Date): DealState {
  return deal.status === 'OPEN' && lastPickup(deal) <= now ? 'EXPIRED' : deal.status;
}

/**
 * 特價車: a driver offers a trip at their own price, whole car, and sends its link to passengers
 * themselves. A passenger books it without an account; the booking is a 名片頁 request
 * (BookingRequest with dealId) at the deal's price, so the driver answers it in 等我報價 and makes
 * it an order the same way. One car, one party: making the order (or 自動接受第一組) gives the deal
 * to that party and declines the rest. The platform never lists, recommends or prices a deal.
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
            autoAccept: input.autoAccept,
            createdAt: now,
          },
          include: dealInclude,
        });
        telemetry.domain('deal.create');
        return this.driverView(deal, now);
      } catch (error) {
        const collided = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!collided || attempt >= 2) throw error;
      }
    }
  }

  async list(userId: string, now = new Date()) {
    const rows = await this.prisma.deal.findMany({ where: { driverId: userId }, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT, include: dealInclude });
    return rows.map((row) => this.driverView(row, now));
  }

  async get(userId: string, id: string, now = new Date()) {
    const deal = await this.prisma.deal.findFirst({ where: { id, driverId: userId }, include: dealInclude });
    if (!deal) throw this.notFound();
    return this.driverView(deal, now);
  }

  /** Changes while it takes bookings. Bookings already sent keep their own time and price. */
  async update(userId: string, id: string, input: DealUpdate, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const found = await tx.deal.findFirst({ where: { id, driverId: userId }, select: { id: true } });
      if (!found) throw this.notFound();
      const deal = await lockDeal(tx, id);
      if (dealState(deal, now) !== 'OPEN') throw this.notOpen();
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
          ...(input.autoAccept !== undefined ? { autoAccept: input.autoAccept } : {}),
        },
      });
    });
    return this.get(userId, id, now);
  }

  /** 下架: no more bookings; the parties still waiting are declined. Once it is an order, the order is cancelled instead. */
  async cancel(userId: string, id: string, now = new Date()) {
    const found = await this.prisma.deal.findFirst({ where: { id, driverId: userId }, select: { id: true } });
    if (!found) throw this.notFound();
    await this.prisma.$transaction((tx) => takeDown(tx, id, now, null));
    telemetry.domain('deal.cancel');
    return this.get(userId, id, now);
  }

  // ------------------------------------------------- the platform's staff

  /** A user's deals, newest first, for the admin's user details. */
  async staffList(userId: string, now = new Date()) {
    const rows = await this.prisma.deal.findMany({ where: { driverId: userId }, orderBy: { createdAt: 'desc' }, take: LIST_LIMIT, include: dealInclude });
    return rows.map((row) => ({
      id: row.id,
      url: this.url(row.code),
      state: dealState(row, now),
      pickupAt: row.pickupAt.toISOString(),
      pickupUntil: row.pickupUntil?.toISOString() ?? null,
      origin: row.origin,
      destination: row.destination,
      price: money(row.priceMinor, row.currency),
      originalPrice: money(row.originalPriceMinor, row.currency),
      bookings: row.bookings.length,
      staffReason: row.staffReason,
      createdAt: row.createdAt.toISOString(),
    }));
  }

  /** 下架 after a complaint; the reason is shown to the driver. */
  async staffCancel(userId: string, id: string, reason: string, now = new Date()) {
    const found = await this.prisma.deal.findFirst({ where: { id, driverId: userId }, select: { id: true } });
    if (!found) throw this.notFound();
    await this.prisma.$transaction((tx) => takeDown(tx, id, now, reason));
  }

  // ----------------------------------------------------------- the public

  async publicDeal(code: string, now = new Date()) {
    const deal = await this.prisma.deal.findUnique({ where: { code }, include: dealInclude });
    if (!deal) throw this.notFound();
    return { code: deal.code, ...this.tripFields(deal, now), autoAccept: deal.autoAccept, driver: await this.carOf(deal) };
  }

  /** The driver's car photo on the deal's link, while it is up. */
  async photo(code: string, photoId: string) {
    const deal = await this.prisma.deal.findUnique({ where: { code }, select: { driverId: true, status: true } });
    const photo =
      deal && deal.status !== 'CANCELLED'
        ? await this.prisma.profilePhoto.findFirst({ where: { id: photoId, page: { userId: deal.driverId, blockedAt: null } } })
        : null;
    const bytes = photo ? await this.storage.read(photo.storageKey) : null;
    if (!photo || !bytes) throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'Photo not found');
    return { mime: photo.mimeType, bytes };
  }

  /**
   * A passenger books the deal. It becomes a request in the driver's 等我報價 at the deal's price;
   * with 自動接受第一組 the first one gets the deal at once. The passenger follows it on /b/{code}.
   */
  async createBooking(code: string, input: DealBookingCreate, ip: string | undefined, now = new Date()) {
    const found = await this.prisma.deal.findUnique({ where: { code }, select: { id: true, driverId: true } });
    if (!found) throw this.notFound();
    const page = await this.pages.ensurePage(found.driverId);
    const limits = await readLimits(this.prisma);
    const since = new Date(now.getTime() - DAY_MS);
    const [fromAddress, onPage] = await Promise.all([
      ip ? this.prisma.bookingRequest.count({ where: { ip, createdAt: { gte: since } } }) : 0,
      this.prisma.bookingRequest.count({ where: { pageId: page.id, createdAt: { gte: since } } }),
    ]);
    if (fromAddress >= limits.bookingPerIpPerDay) throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'BOOKING_LIMIT', 'Too many booking requests from this address today');
    if (onPage >= limits.bookingPerPagePerDay) throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'BOOKING_PAGE_FULL', 'This driver has received their bookings for today');

    const { booking, deal } = await this.prisma.$transaction(async (tx) => {
      const deal = await lockDeal(tx, found.id);
      if (dealState(deal, now) !== 'OPEN') throw this.notOpen();
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
      const mine = await tx.bookingRequest.count({
        where: { dealId: deal.id, passengerContact: input.passengerContact, status: { in: ['PENDING', ...HOLDING] } },
      });
      if (mine > 0) throw apiError(HttpStatus.CONFLICT, 'DEAL_ALREADY_BOOKED', 'This phone already booked this deal');
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
      if (deal.autoAccept) await tx.deal.update({ where: { id: deal.id }, data: { status: 'SOLD', soldAt: now } });
      return { booking, deal };
    });
    await this.notifications.send({ userId: deal.driverId, kind: deal.autoAccept ? 'DEAL_SOLD' : 'DEAL_BOOKING_NEW', group: 'BOOKINGS', booking });
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
      state: dealState(deal, now),
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

  private driverView(deal: DealRow, now: Date) {
    const url = this.url(deal.code);
    const profile = deal.driver.profile;
    const page = deal.driver.profilePage && !deal.driver.profilePage.blockedAt ? deal.driver.profilePage : null;
    return {
      id: deal.id,
      code: deal.code,
      url,
      ...this.tripFields(deal, now),
      autoAccept: deal.autoAccept,
      soldAt: deal.soldAt?.toISOString() ?? null,
      cancelledAt: deal.cancelledAt?.toISOString() ?? null,
      staffReason: deal.staffReason,
      createdAt: deal.createdAt.toISOString(),
      /** Bookings still waiting on the driver. */
      waiting: deal.bookings.filter((booking) => booking.status === 'PENDING').length,
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

  private notFound() {
    return apiError(HttpStatus.NOT_FOUND, 'DEAL_NOT_FOUND', 'Deal not found');
  }

  private notOpen() {
    return apiError(HttpStatus.CONFLICT, 'DEAL_NOT_OPEN', 'This deal takes no more bookings');
  }
}
