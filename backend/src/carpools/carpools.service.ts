import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  CARPOOL_DEFAULT_CLOSE_HOURS,
  CARPOOL_PENDING_HOURS,
  type CarpoolCreate,
  type CarpoolSeatCreate,
  type CarpoolStart,
  type CarpoolUpdate,
  type CreateOrderInput,
} from '@masterdriver/shared';
import { Prisma, type CarpoolSeatStatus, type CarpoolStatus } from '../../generated/prisma';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomCode } from '../common/crypto';
import { apiError } from '../common/errors';
import { readLimits } from '../common/limits';
import { NotificationsService } from '../notifications/notifications.service';
import { telemetry } from '../observability/telemetry';
import { phonesOf } from '../orders/order-view';
import { OrdersService } from '../orders/orders.service';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PrismaService } from '../prisma.service';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';
import { carpoolInviteText } from './carpool-share-text';

const CODE_LENGTH = 10;
const SEAT_CODE_LENGTH = 16;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const LIST_LIMIT = 50;
/** A seat the passenger can still be on: asked for and not answered yet, or confirmed. */
const LIVE: CarpoolSeatStatus[] = ['PENDING', 'CONFIRMED'];

type Money = { amount: number; currency: 'HKD' | 'CNY' | 'MOP' } | null | undefined;
const toMinor = (price: Money) => (price ? Math.round(price.amount * 100) : null);
const money = (minor: number | null, currency: string) => (minor === null ? null : { amount: minor / 100, currency });

/** The driver's car and how to reach them, as a carpool's passengers see it. */
const driverSelect = {
  select: {
    id: true,
    countryCode: true,
    phone: true,
    profile: true,
    profilePage: { select: { code: true, published: true, blockedAt: true, wechatId: true, whatsapp: true, photos: { select: { id: true }, orderBy: { createdAt: 'desc' }, take: 1 } } },
  },
} as const;

const carpoolInclude = {
  seatsList: { orderBy: { createdAt: 'asc' } },
  driver: driverSelect,
  order: { select: { id: true, status: true, claimedById: true, departedAt: true, claimedBy: driverSelect } },
} satisfies Prisma.CarpoolInclude;
type CarpoolRow = Prisma.CarpoolGetPayload<{ include: typeof carpoolInclude }>;
type SeatRow = CarpoolRow['seatsList'][number];
type DriverRow = CarpoolRow['driver'];

/** A seat holds its seats while confirmed, or while it waits for the driver and has not run out. */
const holds = (seat: Pick<SeatRow, 'status' | 'expiresAt'>, now: Date) =>
  seat.status === 'CONFIRMED' || (seat.status === 'PENDING' && Boolean(seat.expiresAt && seat.expiresAt > now));
/** 成行 counts confirmed parties who accepted the carpool as it is now. */
const counts = (seat: Pick<SeatRow, 'status' | 'reconfirmAt'>) => seat.status === 'CONFIRMED' && !seat.reconfirmAt;

/**
 * 拼車: a driver opens a trip and gives its link to passengers, who ask for seats on it. The
 * platform keeps the seats so the car is never sold twice, and passes requests and answers
 * between them; it never lists, recommends or prices a carpool. Closed, the carpool becomes one
 * order, driven by the driver or put out for another, through OrdersService.
 */
@Injectable()
export class CarpoolsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
    @Inject(PaymentMethodsService) private readonly paymentMethods: PaymentMethodsService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  // ------------------------------------------------------------ the driver

  async create(userId: string, input: CarpoolCreate, now = new Date()) {
    const pickupAt = new Date(input.pickupAt);
    const closesAt = input.closesAt
      ? new Date(input.closesAt)
      : new Date(Math.max(pickupAt.getTime() - CARPOOL_DEFAULT_CLOSE_HOURS * HOUR_MS, Math.min(pickupAt.getTime(), now.getTime() + HOUR_MS)));
    await this.check(userId, { pickupAt, closesAt, seats: input.seats, minPassengers: input.minPassengers ?? null, held: 0 }, now);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const carpool = await this.prisma.carpool.create({
          data: {
            code: randomCode(CODE_LENGTH),
            driverId: userId,
            pickupAt,
            origin: input.origin,
            destination: input.destination,
            pickupPoints: input.pickupPoints,
            seats: input.seats,
            minPassengers: input.minPassengers ?? null,
            seatPriceMinor: toMinor(input.seatPrice),
            seatCurrency: input.seatPrice?.currency ?? 'HKD',
            luggagePerSeat: input.luggagePerSeat ?? null,
            cancelPolicy: input.cancelPolicy ?? null,
            notes: input.notes ?? null,
            closesAt,
            autoConfirm: input.autoConfirm,
            waitMinutes: input.waitMinutes,
            showPaymentMethods: input.showPaymentMethods,
            createdAt: now,
          },
          include: carpoolInclude,
        });
        telemetry.domain('carpool.create');
        return this.driverView(carpool, now);
      } catch (error) {
        const collided = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!collided || attempt >= 2) throw error;
      }
    }
  }

  async list(userId: string, now = new Date()) {
    await this.expire({ carpool: { driverId: userId } }, now);
    const rows = await this.prisma.carpool.findMany({
      where: { driverId: userId },
      orderBy: { pickupAt: 'desc' },
      take: LIST_LIMIT,
      include: carpoolInclude,
    });
    return rows.map((row) => this.driverView(row, now));
  }

  /** New seats the driver has not opened yet, waiting for them to confirm. */
  async unread(userId: string, now = new Date()) {
    return {
      count: await this.prisma.carpoolSeat.count({
        where: { carpool: { driverId: userId }, driverUnread: true, status: 'PENDING', expiresAt: { gt: now } },
      }),
    };
  }

  /** Opening the carpool marks its seats read. */
  async get(userId: string, id: string, now = new Date()) {
    await this.own(userId, id);
    await this.expire({ carpoolId: id }, now);
    await this.prisma.carpoolSeat.updateMany({ where: { carpoolId: id, driverUnread: true }, data: { driverUnread: false } });
    return this.driverView(await this.read(id), now);
  }

  /**
   * Changes before the carpool becomes an order. A new time or seat price is a different deal:
   * every party still on accepts it again on their own link. A later 報位截止 opens a closed
   * carpool again.
   */
  async update(userId: string, id: string, input: CarpoolUpdate, now = new Date()) {
    const formed = await this.prisma.$transaction(async (tx) => {
      const carpool = await this.lock(tx, userId, id);
      if (carpool.status !== 'OPEN' && carpool.status !== 'CLOSED') throw this.ended();
      const seats = await tx.carpoolSeat.findMany({ where: { carpoolId: id, status: { in: LIVE } } });
      const held = seats.filter((seat) => holds(seat, now)).reduce((sum, seat) => sum + seat.passengers, 0);
      const pickupAt = input.pickupAt ? new Date(input.pickupAt) : carpool.pickupAt;
      const closesAt = input.closesAt ? new Date(input.closesAt) : carpool.closesAt;
      const minPassengers = input.minPassengers === undefined ? carpool.minPassengers : input.minPassengers;
      await this.check(userId, { pickupAt, closesAt, seats: input.seats ?? carpool.seats, minPassengers, held }, now, Boolean(input.pickupAt || input.closesAt));

      const priceMinor = input.seatPrice === undefined ? carpool.seatPriceMinor : toMinor(input.seatPrice);
      const currency = input.seatPrice ? input.seatPrice.currency : carpool.seatCurrency;
      const newDeal =
        pickupAt.getTime() !== carpool.pickupAt.getTime() || priceMinor !== carpool.seatPriceMinor || currency !== carpool.seatCurrency;
      const reopened = input.closesAt !== undefined && closesAt > now && carpool.status === 'CLOSED';
      await tx.carpool.update({
        where: { id },
        data: {
          pickupAt,
          closesAt,
          minPassengers,
          seatPriceMinor: priceMinor,
          seatCurrency: currency,
          ...(input.origin !== undefined ? { origin: input.origin } : {}),
          ...(input.destination !== undefined ? { destination: input.destination } : {}),
          ...(input.pickupPoints !== undefined ? { pickupPoints: input.pickupPoints } : {}),
          ...(input.seats !== undefined ? { seats: input.seats } : {}),
          ...(input.luggagePerSeat !== undefined ? { luggagePerSeat: input.luggagePerSeat } : {}),
          ...(input.cancelPolicy !== undefined ? { cancelPolicy: input.cancelPolicy || null } : {}),
          ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
          ...(input.autoConfirm !== undefined ? { autoConfirm: input.autoConfirm } : {}),
          ...(input.waitMinutes !== undefined ? { waitMinutes: input.waitMinutes } : {}),
          ...(input.showPaymentMethods !== undefined ? { showPaymentMethods: input.showPaymentMethods } : {}),
          ...(reopened ? { status: 'OPEN', closedAt: null } : {}),
        },
      });
      if (newDeal) await tx.carpoolSeat.updateMany({ where: { carpoolId: id, status: { in: LIVE } }, data: { reconfirmAt: now } });
      return this.refreshFormed(tx, id, now);
    });
    await this.tellFormed(formed);
    return this.get(userId, id, now);
  }

  /** 停止報位: no more seats; the ones asked for stay, and the driver still answers those waiting. */
  async close(userId: string, id: string, now = new Date()) {
    await this.own(userId, id);
    const closed = await this.prisma.carpool.updateMany({ where: { id, driverId: userId, status: 'OPEN' }, data: { status: 'CLOSED', closedAt: now } });
    if (closed.count === 0) throw this.ended();
    return this.get(userId, id, now);
  }

  /** The whole carpool is off. Once it is an order, that order is cancelled, which takes the carpool with it. */
  async cancel(userId: string, id: string, now = new Date()) {
    const carpool = await this.own(userId, id);
    if (carpool.status === 'ORDERED' && carpool.orderId) {
      await this.orders.cancel(userId, carpool.orderId, now);
      return this.get(userId, id, now);
    }
    const cancelled = await this.prisma.carpool.updateMany({
      where: { id, driverId: userId, status: { in: ['OPEN', 'CLOSED'] } },
      data: { status: 'CANCELLED', cancelledAt: now },
    });
    if (cancelled.count === 0) throw this.ended();
    telemetry.domain('carpool.cancel');
    return this.get(userId, id, now);
  }

  /**
   * 成單: once no more seats are taken, the carpool becomes one order: driven by the driver who
   * opened it (這單我自己做), or put out for another driver to claim at a driver price. It costs a
   * quota and the service fee like any order. Every party must be settled first: none waiting for
   * the driver, none yet to accept a changed time or price.
   */
  async start(userId: string, id: string, input: CarpoolStart, now = new Date()) {
    const carpool = await this.own(userId, id);
    await this.expire({ carpoolId: id }, now);
    if (carpool.status !== 'OPEN' && carpool.status !== 'CLOSED') throw this.ended();
    if (this.statusOf(carpool, now) === 'OPEN') {
      throw apiError(HttpStatus.CONFLICT, 'CARPOOL_STILL_OPEN', 'Stop taking seats before making the carpool an order');
    }
    const seats = await this.prisma.carpoolSeat.findMany({ where: { carpoolId: id, status: { in: LIVE } } });
    const waiting = seats.filter((seat) => seat.status === 'PENDING').length;
    if (waiting > 0) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_PENDING_SEATS', 'Answer the seats waiting for you first', { count: waiting });
    const unaccepted = seats.filter((seat) => seat.reconfirmAt).length;
    if (unaccepted > 0) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_RECONFIRM_PENDING', 'Some passengers have not accepted the change', { count: unaccepted });
    if (seats.length === 0) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_NO_PASSENGERS', 'No confirmed passengers');

    const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { vehicleType: true } });
    const self = input.mode === 'SELF';
    const order: CreateOrderInput = {
      pickupAt: carpool.pickupAt.toISOString(),
      origin: carpool.origin,
      destination: carpool.destination,
      waypoints: [],
      // Set from the confirmed parties when the carpool is taken, in the same transaction.
      passengers: seats.reduce((sum, seat) => sum + seat.passengers, 0),
      luggage: seats.reduce((sum, seat) => sum + seat.luggage, 0),
      vehicleType: self ? (profile?.vehicleType ?? undefined) : input.vehicleType,
      driverPrice: self ? undefined : input.driverPrice,
      showPassengerPrice: false,
      notes: carpool.notes ?? undefined,
      // Each party is its own passenger, kept on the carpool's seats.
      passengerContact: '',
      favoritesFirst: false,
      immediate: false,
      contactRevealMinutes: self ? undefined : input.contactRevealMinutes,
      requiredPlates: [],
      selfDrive: self,
      inPool: self ? undefined : input.inPool,
      showPaymentMethods: false,
    };
    const made = await this.orders.create(userId, order, now, { id });
    telemetry.domain('carpool.start', self ? 'self' : 'dispatch');
    return { orderId: made.id as string, carpool: await this.get(userId, id, now) };
  }

  async confirmSeat(userId: string, id: string, seatId: string, now = new Date()) {
    const formed = await this.prisma.$transaction(async (tx) => {
      const carpool = await this.lock(tx, userId, id);
      if (carpool.status !== 'OPEN' && carpool.status !== 'CLOSED') throw this.ended();
      const confirmed = await tx.carpoolSeat.updateMany({
        where: { id: seatId, carpoolId: id, status: 'PENDING', expiresAt: { gt: now } },
        data: { status: 'CONFIRMED', confirmedAt: now, expiresAt: null, driverUnread: false },
      });
      if (confirmed.count === 0) throw this.seatNotWaiting();
      return this.refreshFormed(tx, id, now);
    });
    await this.tellFormed(formed);
    return this.get(userId, id, now);
  }

  async declineSeat(userId: string, id: string, seatId: string, now = new Date()) {
    await this.own(userId, id);
    const declined = await this.prisma.carpoolSeat.updateMany({
      where: { id: seatId, carpoolId: id, status: 'PENDING', carpool: { status: { in: ['OPEN', 'CLOSED'] } } },
      data: { status: 'DECLINED', expiresAt: null, driverUnread: false },
    });
    if (declined.count === 0) throw this.seatNotWaiting();
    return this.get(userId, id, now);
  }

  /**
   * The driver takes a party off: before the carpool is an order, or after, until that party is
   * on board. An order already made follows with its load, and its driver is told.
   */
  async removeSeat(userId: string, id: string, seatId: string, now = new Date()) {
    const carpool = await this.own(userId, id);
    await this.leave({ id: seatId, carpoolId: id }, 'REMOVED', now);
    if (carpool.orderId) await this.orders.carpoolPartiesChanged(carpool.orderId, now);
    return this.get(userId, id, now);
  }

  // ----------------------------------------------------------- the public

  /** The link the driver gives passengers: the trip, the seats left, and who drives. */
  async publicCarpool(code: string, now = new Date()) {
    const carpool = await this.prisma.carpool.findUnique({ where: { code }, include: carpoolInclude });
    if (!carpool) throw this.notFound();
    await this.expire({ carpoolId: carpool.id }, now);
    const seats = await this.prisma.carpoolSeat.findMany({ where: { carpoolId: carpool.id, status: { in: LIVE } } });
    return {
      ...this.tripFields(carpool, seats, now),
      code: carpool.code,
      autoConfirm: carpool.autoConfirm,
      driver: await this.carOf(carpool.driver, `/api/public/carpools/${carpool.code}/photos`, false),
    };
  }

  /**
   * A party asks for seats. Under the carpool's lock, so the last seats go to one party only.
   * Confirmed at once when the driver chose so; otherwise held for CARPOOL_PENDING_HOURS, or until
   * asking closes, for the driver to answer.
   */
  async createSeat(code: string, input: CarpoolSeatCreate, ip: string | undefined, now = new Date()) {
    const found = await this.prisma.carpool.findUnique({ where: { code }, select: { id: true } });
    if (!found) throw this.notFound();
    const limits = await readLimits(this.prisma);
    if (ip && (await this.prisma.carpoolSeat.count({ where: { ip, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } })) >= limits.bookingPerIpPerDay) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'CARPOOL_SEAT_LIMIT', 'Too many seats asked for from this address today');
    }
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Carpool" WHERE "id" = ${found.id} FOR UPDATE`;
      const carpool = await tx.carpool.findUniqueOrThrow({ where: { id: found.id } });
      if (this.statusOf(carpool, now) !== 'OPEN') throw apiError(HttpStatus.CONFLICT, 'CARPOOL_CLOSED', 'This carpool takes no more seats');
      if (carpool.pickupPoints.length > 0 && !carpool.pickupPoints.includes(input.pickupPoint)) {
        throw apiError(HttpStatus.BAD_REQUEST, 'CARPOOL_PICKUP_POINT', 'Choose one of the pickup points');
      }
      if (carpool.luggagePerSeat !== null && input.luggage > carpool.luggagePerSeat * input.passengers) {
        throw apiError(HttpStatus.BAD_REQUEST, 'CARPOOL_TOO_MUCH_LUGGAGE', 'Too much luggage for this carpool', { perSeat: carpool.luggagePerSeat });
      }
      const live = await tx.carpoolSeat.findMany({ where: { carpoolId: carpool.id, status: { in: LIVE } } });
      if (live.some((seat) => holds(seat, now) && seat.passengerContact === input.passengerContact)) {
        throw apiError(HttpStatus.CONFLICT, 'CARPOOL_ALREADY_BOOKED', 'This phone already has seats on this carpool');
      }
      const left = carpool.seats - live.filter((seat) => holds(seat, now)).reduce((sum, seat) => sum + seat.passengers, 0);
      if (input.passengers > left) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_NOT_ENOUGH_SEATS', 'Not enough seats left', { left: Math.max(0, left) });
      const seat = await tx.carpoolSeat.create({
        data: {
          carpoolId: carpool.id,
          code: randomCode(SEAT_CODE_LENGTH),
          status: carpool.autoConfirm ? 'CONFIRMED' : 'PENDING',
          passengers: input.passengers,
          luggage: input.luggage,
          pickupPoint: input.pickupPoint,
          dropoff: input.dropoff ?? null,
          passengerName: input.passengerName,
          passengerContact: input.passengerContact,
          passengerWechat: input.passengerWechat ?? null,
          notes: input.notes ?? null,
          ip: ip ?? null,
          expiresAt: carpool.autoConfirm ? null : new Date(Math.min(now.getTime() + CARPOOL_PENDING_HOURS * HOUR_MS, carpool.closesAt.getTime())),
          confirmedAt: carpool.autoConfirm ? now : null,
          createdAt: now,
        },
      });
      return { seat, carpool, formed: carpool.autoConfirm ? await this.refreshFormed(tx, carpool.id, now) : null };
    });
    await this.notifications.send({
      userId: result.carpool.driverId,
      kind: result.carpool.autoConfirm ? 'CARPOOL_SEAT_NEW' : 'CARPOOL_SEAT_WAITING',
      group: 'BOOKINGS',
      carpool: result.carpool,
    });
    await this.tellFormed(result.formed);
    telemetry.domain('carpool.seat');
    return { code: result.seat.code, url: `${this.config.publicBaseUrl}/s/${result.seat.code}` };
  }

  /** What the passenger sees behind their own link. */
  async passengerSeat(code: string, now = new Date()) {
    const found = await this.prisma.carpoolSeat.findUnique({ where: { code }, select: { carpoolId: true } });
    if (!found) throw this.seatNotFound();
    await this.expire({ carpoolId: found.carpoolId }, now);
    const seat = await this.prisma.carpoolSeat.findUniqueOrThrow({ where: { code } });
    const carpool = await this.read(seat.carpoolId);
    const live = carpool.seatsList.filter((one) => LIVE.includes(one.status));
    const confirmed = seat.status === 'CONFIRMED';
    const order = carpool.order;
    const over = carpool.status === 'CANCELLED' || order?.status === 'CANCELLED';
    // Who drives: the driver who took the order put out, or else the driver who opened the carpool.
    const driving = order && order.claimedBy && order.claimedById !== carpool.driverId && order.status !== 'OPEN' ? order.claimedBy : carpool.driver;
    const done = order?.status === 'COMPLETED';
    const price = carpool.seatPriceMinor === null ? null : money(carpool.seatPriceMinor * seat.passengers, carpool.seatCurrency);
    const payment =
      confirmed && !over && carpool.showPaymentMethods
        ? {
            payee: carpool.driver.profile?.name ?? null,
            amount: price,
            paid: Boolean(seat.paidAt),
            methods: await this.paymentMethods.forPassenger(carpool.driverId, seat.code, 's'),
          }
        : null;
    return {
      ...this.tripFields(carpool, live, now),
      seat: {
        code: seat.code,
        status: seat.status,
        passengers: seat.passengers,
        luggage: seat.luggage,
        pickupPoint: seat.pickupPoint,
        dropoff: seat.dropoff ?? carpool.destination,
        passengerName: seat.passengerName,
        notes: seat.notes,
        price,
        expiresAt: seat.expiresAt?.toISOString() ?? null,
        reconfirm: Boolean(seat.reconfirmAt) && LIVE.includes(seat.status),
        confirmedAt: seat.confirmedAt?.toISOString() ?? null,
        cancelledAt: seat.cancelledAt?.toISOString() ?? null,
        progress: {
          departedAt: order?.departedAt?.toISOString() ?? null,
          arrivedAt: seat.arrivedAt?.toISOString() ?? null,
          pickedUpAt: seat.pickedUpAt?.toISOString() ?? null,
          noShowAt: seat.noShowAt?.toISOString() ?? null,
          droppedAt: seat.droppedAt?.toISOString() ?? null,
        },
        canCancel: LIVE.includes(seat.status) && !over && !seat.pickedUpAt && (!order || order.status === 'OPEN' || order.status === 'ASSIGNED'),
      },
      orderStatus: order?.status ?? null,
      // Put out and nobody has it yet: the passenger is told a driver is being arranged.
      arranging: Boolean(order && order.status === 'OPEN'),
      // Phones only once the passenger's seats are confirmed, and not after the trip.
      driver: confirmed && !over ? await this.carOf(driving, `/api/s/${seat.code}/driver-photos`, !done) : null,
      organizer:
        confirmed && !over && driving !== carpool.driver
          ? { name: carpool.driver.profile?.name ?? null, phones: phonesOf(carpool.driver), ...this.pageContact(carpool.driver) }
          : null,
      payment,
    };
  }

  /** The passenger withdraws, until they are on board. The driver is told. */
  async passengerCancel(code: string, now = new Date()) {
    const seat = await this.prisma.carpoolSeat.findUnique({ where: { code }, include: { carpool: true } });
    if (!seat) throw this.seatNotFound();
    await this.leave({ code }, 'CANCELLED', now);
    await this.notifications.send({ userId: seat.carpool.driverId, kind: 'CARPOOL_SEAT_CANCELLED', group: 'BOOKINGS', carpool: seat.carpool });
    if (seat.carpool.orderId) await this.orders.carpoolPartiesChanged(seat.carpool.orderId, now);
    return this.passengerSeat(code, now);
  }

  /** 接受新的安排: the passenger accepts the changed time or price. */
  async passengerReconfirm(code: string, now = new Date()) {
    const seat = await this.prisma.carpoolSeat.findUnique({ where: { code }, select: { carpoolId: true } });
    if (!seat) throw this.seatNotFound();
    const formed = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Carpool" WHERE "id" = ${seat.carpoolId} FOR UPDATE`;
      const accepted = await tx.carpoolSeat.updateMany({
        where: { code, status: { in: LIVE }, reconfirmAt: { not: null }, carpool: { status: { in: ['OPEN', 'CLOSED'] } } },
        data: { reconfirmAt: null, driverUnread: true },
      });
      if (accepted.count === 0) throw this.seatClosed();
      return this.refreshFormed(tx, seat.carpoolId, now);
    });
    await this.tellFormed(formed);
    return this.passengerSeat(code, now);
  }

  /** The vehicle photo on the carpool link: the driver who opened it, while it is not cancelled. */
  async carpoolPhoto(code: string, photoId: string) {
    const carpool = await this.prisma.carpool.findUnique({ where: { code }, select: { driverId: true, status: true } });
    return this.photoOf(carpool && carpool.status !== 'CANCELLED' ? [carpool.driverId] : [], photoId);
  }

  /** The vehicle photo on a passenger's link: of whoever drives them, once their seats are confirmed. */
  async seatPhoto(code: string, photoId: string) {
    const seat = await this.prisma.carpoolSeat.findUnique({
      where: { code },
      select: { status: true, carpool: { select: { driverId: true, status: true, order: { select: { claimedById: true } } } } },
    });
    const drivers = seat?.status === 'CONFIRMED' && seat.carpool.status !== 'CANCELLED' ? [seat.carpool.driverId, seat.carpool.order?.claimedById] : [];
    return this.photoOf(drivers.filter((id): id is string => Boolean(id)), photoId);
  }

  /** A payment QR on a passenger's link: their seats confirmed, and the carpool showing the driver's ways to be paid. */
  async seatQr(code: string, methodId: string) {
    const seat = await this.prisma.carpoolSeat.findUnique({
      where: { code },
      select: { status: true, carpool: { select: { driverId: true, status: true, showPaymentMethods: true } } },
    });
    if (!seat || seat.status !== 'CONFIRMED' || seat.carpool.status === 'CANCELLED' || !seat.carpool.showPaymentMethods) return null;
    return this.paymentMethods.ownQr(seat.carpool.driverId, methodId);
  }

  // --------------------------------------------------------------- internals

  /** A carpool reads as closed once its 報位截止 has passed, before anyone marks it. */
  private statusOf(carpool: { status: CarpoolStatus; closesAt: Date }, now: Date): CarpoolStatus {
    return carpool.status === 'OPEN' && carpool.closesAt <= now ? 'CLOSED' : carpool.status;
  }

  /** Seats the driver did not answer in time stop holding their seats. */
  private async expire(where: Prisma.CarpoolSeatWhereInput, now: Date) {
    await this.prisma.carpoolSeat.updateMany({ where: { ...where, status: 'PENDING', expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
  }

  /**
   * 成行 is recorded the first time confirmed passengers reach the least the carpool goes with,
   * and cleared when they drop below. Returns the carpool when it has just formed, to be told.
   */
  private async refreshFormed(tx: Prisma.TransactionClient, id: string, now: Date) {
    const carpool = await tx.carpool.findUniqueOrThrow({ where: { id } });
    const seats = await tx.carpoolSeat.findMany({ where: { carpoolId: id, status: 'CONFIRMED' }, select: { status: true, reconfirmAt: true, passengers: true } });
    const counted = seats.filter(counts).reduce((sum, seat) => sum + seat.passengers, 0);
    const formed = carpool.minPassengers !== null && counted >= carpool.minPassengers;
    if (formed && !carpool.formedAt) {
      await tx.carpool.update({ where: { id }, data: { formedAt: now } });
      return carpool;
    }
    if (!formed && carpool.formedAt) await tx.carpool.update({ where: { id }, data: { formedAt: null } });
    return null;
  }

  private async tellFormed(carpool: { id: string; driverId: string; origin: string; destination: string; pickupAt: Date } | null) {
    if (carpool) await this.notifications.send({ userId: carpool.driverId, kind: 'CARPOOL_FORMED', group: 'BOOKINGS', carpool });
  }

  /**
   * A party leaves (cancelled by the passenger, or removed by the driver), under the carpool's
   * lock: while it is still on, until they are on board, and not after the trip is over.
   */
  private async leave(where: Prisma.CarpoolSeatWhereInput, status: CarpoolSeatStatus, now: Date) {
    const seat = await this.prisma.carpoolSeat.findFirst({ where, select: { id: true, carpoolId: true } });
    if (!seat) throw this.seatNotFound();
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Carpool" WHERE "id" = ${seat.carpoolId} FOR UPDATE`;
      const left = await tx.carpoolSeat.updateMany({
        where: {
          id: seat.id,
          status: { in: LIVE },
          pickedUpAt: null,
          carpool: { OR: [{ status: { in: ['OPEN', 'CLOSED'] } }, { status: 'ORDERED', order: { status: { in: ['OPEN', 'ASSIGNED'] } } }] },
        },
        data: { status, cancelledAt: now, expiresAt: null, driverUnread: status === 'CANCELLED' },
      });
      if (left.count === 0) throw this.seatClosed();
      // A party leaving can only take 成行 away, so there is nothing to tell here.
      await this.refreshFormed(tx, seat.carpoolId, now);
    });
  }

  /** The time, seat and price checks shared by opening and changing a carpool. */
  private async check(
    userId: string,
    value: { pickupAt: Date; closesAt: Date; seats: number; minPassengers: number | null; held: number },
    now: Date,
    timesChanged = true,
  ) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { seats: true } });
    if (!profile) throw apiError(HttpStatus.CONFLICT, 'PROFILE_REQUIRED', 'Fill in your driver details first');
    if (!profile.seats || profile.seats < 2) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_SEATS_REQUIRED', 'Fill in the seats of your car first');
    // The driver has a seat of their own.
    if (value.seats > profile.seats - 1) {
      throw apiError(HttpStatus.BAD_REQUEST, 'CARPOOL_TOO_MANY_SEATS', 'More seats than the car has', { max: profile.seats - 1 });
    }
    if (value.seats < value.held) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_SEATS_BELOW_HELD', 'Fewer seats than passengers already have', { held: value.held });
    if (value.minPassengers !== null && value.minPassengers > value.seats) {
      throw apiError(HttpStatus.BAD_REQUEST, 'CARPOOL_MIN_OVER_SEATS', 'The least to go with is more than the seats');
    }
    if (timesChanged && value.pickupAt <= now) throw apiError(HttpStatus.BAD_REQUEST, 'CARPOOL_IN_THE_PAST', 'Choose a time in the future');
    if (value.closesAt > value.pickupAt || (timesChanged && value.closesAt <= now)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'CARPOOL_CLOSES_AT_INVALID', 'Asking for seats must close after now and by the pickup time');
    }
  }

  private async own(userId: string, id: string) {
    const carpool = await this.prisma.carpool.findFirst({ where: { id, driverId: userId } });
    if (!carpool) throw this.notFound();
    return carpool;
  }

  private async lock(tx: Prisma.TransactionClient, userId: string, id: string) {
    await tx.$queryRaw`SELECT "id" FROM "Carpool" WHERE "id" = ${id} FOR UPDATE`;
    const carpool = await tx.carpool.findFirst({ where: { id, driverId: userId } });
    if (!carpool) throw this.notFound();
    return carpool;
  }

  private read(id: string) {
    return this.prisma.carpool.findUniqueOrThrow({ where: { id }, include: carpoolInclude });
  }

  /** What both the carpool link and a passenger's link say about the trip and its seats. */
  private tripFields(carpool: CarpoolRow, live: Pick<SeatRow, 'status' | 'expiresAt' | 'reconfirmAt' | 'passengers'>[], now: Date) {
    const held = live.filter((seat) => holds(seat, now)).reduce((sum, seat) => sum + seat.passengers, 0);
    const counted = live.filter(counts).reduce((sum, seat) => sum + seat.passengers, 0);
    return {
      status: this.statusOf(carpool, now),
      pickupAt: carpool.pickupAt.toISOString(),
      origin: carpool.origin,
      destination: carpool.destination,
      pickupPoints: carpool.pickupPoints,
      seats: carpool.seats,
      left: Math.max(0, carpool.seats - held),
      minPassengers: carpool.minPassengers,
      // 還差 N 位成行; zero once it goes.
      short: carpool.minPassengers === null ? 0 : Math.max(0, carpool.minPassengers - counted),
      seatPrice: money(carpool.seatPriceMinor, carpool.seatCurrency),
      luggagePerSeat: carpool.luggagePerSeat,
      cancelPolicy: carpool.cancelPolicy,
      notes: carpool.notes,
      closesAt: carpool.closesAt.toISOString(),
      waitMinutes: carpool.waitMinutes,
    };
  }

  private pageContact(person: DriverRow) {
    return { wechatId: person.profilePage?.wechatId || null, whatsapp: person.profilePage?.whatsapp || null };
  }

  /**
   * The car a passenger looks for, and with `withPhones` how to reach its driver. Plates follow
   * the driver's choice to keep them from passengers. Photos are served under `photoPath`.
   */
  private async carOf(person: DriverRow, photoPath: string, withPhones: boolean) {
    const profile = person.profile;
    const hide = profile?.hidePlates ?? false;
    const page = person.profilePage && !person.profilePage.blockedAt ? person.profilePage : null;
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
      completedTrips: await this.prisma.order.count({ where: { claimedById: person.id, status: 'COMPLETED' } }),
      photos: page?.photos.map((photo) => `${photoPath}/${photo.id}`) ?? [],
      // A public 名片頁, to read more about the driver before asking for seats.
      pageCode: page?.published ? page.code : null,
      ...(withPhones ? { phones: phonesOf(person), ...this.pageContact(person) } : { phones: [] as string[], wechatId: null, whatsapp: null }),
    };
  }

  private async photoOf(drivers: string[], photoId: string) {
    const photo = drivers.length
      ? await this.prisma.profilePhoto.findFirst({ where: { id: photoId, page: { userId: { in: drivers }, blockedAt: null } } })
      : null;
    const bytes = photo ? await this.storage.read(photo.storageKey) : null;
    if (!photo || !bytes) throw apiError(HttpStatus.NOT_FOUND, 'PHOTO_NOT_FOUND', 'Photo not found');
    return { mime: photo.mimeType, bytes };
  }

  private driverView(carpool: CarpoolRow, now: Date) {
    const live = carpool.seatsList.filter((seat) => holds(seat, now));
    const url = `${this.config.publicBaseUrl}/r/${carpool.code}`;
    const trip = this.tripFields(carpool, live, now);
    return {
      id: carpool.id,
      code: carpool.code,
      url,
      ...trip,
      autoConfirm: carpool.autoConfirm,
      showPaymentMethods: carpool.showPaymentMethods,
      formedAt: carpool.formedAt?.toISOString() ?? null,
      closedAt: carpool.closedAt?.toISOString() ?? null,
      cancelledAt: carpool.cancelledAt?.toISOString() ?? null,
      createdAt: carpool.createdAt.toISOString(),
      confirmed: live.filter(counts).reduce((sum, seat) => sum + seat.passengers, 0),
      waiting: live.filter((seat) => seat.status === 'PENDING').length,
      unaccepted: live.filter((seat) => seat.reconfirmAt).length,
      unread: carpool.seatsList.some((seat) => seat.driverUnread && seat.status === 'PENDING' && holds(seat, now)),
      order: carpool.order ? { id: carpool.order.id, status: carpool.order.status } : null,
      seatsList: carpool.seatsList.map((seat) => this.seatForDriver(carpool, seat)),
      share: carpoolInviteText({ ...carpool, left: trip.left, short: trip.short }, url),
    };
  }

  /** A party as the driver sees it. Their phone and WeChat only once the driver confirmed them. */
  private seatForDriver(carpool: CarpoolRow, seat: SeatRow) {
    const confirmed = seat.status === 'CONFIRMED';
    return {
      id: seat.id,
      status: seat.status,
      passengers: seat.passengers,
      luggage: seat.luggage,
      pickupPoint: seat.pickupPoint,
      dropoff: seat.dropoff ?? carpool.destination,
      passengerName: seat.passengerName,
      passengerContact: confirmed ? seat.passengerContact : null,
      passengerWechat: confirmed ? seat.passengerWechat : null,
      notes: seat.notes,
      price: carpool.seatPriceMinor === null ? null : money(carpool.seatPriceMinor * seat.passengers, carpool.seatCurrency),
      expiresAt: seat.expiresAt?.toISOString() ?? null,
      reconfirm: Boolean(seat.reconfirmAt),
      confirmedAt: seat.confirmedAt?.toISOString() ?? null,
      cancelledAt: seat.cancelledAt?.toISOString() ?? null,
      paidAt: seat.paidAt?.toISOString() ?? null,
      createdAt: seat.createdAt.toISOString(),
      unread: seat.driverUnread,
    };
  }

  private ended() {
    return apiError(HttpStatus.CONFLICT, 'CARPOOL_NOT_OPEN', 'The carpool is already an order or cancelled');
  }

  private notFound() {
    return apiError(HttpStatus.NOT_FOUND, 'CARPOOL_NOT_FOUND', 'Carpool not found');
  }

  private seatNotFound() {
    return apiError(HttpStatus.NOT_FOUND, 'CARPOOL_SEAT_NOT_FOUND', 'Seats not found');
  }

  private seatNotWaiting() {
    return apiError(HttpStatus.CONFLICT, 'CARPOOL_SEAT_NOT_PENDING', 'These seats are no longer waiting for an answer');
  }

  private seatClosed() {
    return apiError(HttpStatus.CONFLICT, 'CARPOOL_SEAT_CLOSED', 'These seats can no longer change');
  }
}
