import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  FAVORITES_FIRST_MIN_LEAD_MINUTES,
  FAVORITES_FIRST_MINUTES,
  IMMEDIATE_POOL_MINUTES,
  type ContactRevealUpdate,
  type CreateOrderInput,
  type DriverNoteUpdate,
  type OrderProgress,
  type UpdateTripInput,
  type OrderPaymentUpdate,
  type OrderSettlementUpdate,
  type TripGroupUpdate,
  type OrderListQuery,
  type PoolQuery,
  type PoolUpdate,
  type UpdateOrderPricesInput,
  type CarpoolSeatPayment,
  type CarpoolSeatProgress,
} from '@masterdriver/shared';
import { Prisma, type NotificationKind, type OrderStatus } from '../../generated/prisma';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomCode } from '../common/crypto';
import { apiError } from '../common/errors';
import { CommissionService } from '../billing/commission.service';
import { CreditsService } from '../billing/credits.service';
import { EntitlementsService, FEATURES } from '../entitlements/entitlements.service';
import { GroupInvitesService, WECHAT_GROUP_QR_DAYS } from '../groups/group-invites.service';
import { decodeQrImage } from '../groups/qr-image';
import { NotificationsService } from '../notifications/notifications.service';
import { telemetry } from '../observability/telemetry';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PrismaService } from '../prisma.service';
import { carpoolStopsOf, contactRevealAt, orderInclude, legsOf, passengerPriceOf, toOrderView, toPassengerView, viewerOf, linksOf, type OrderWithPeople } from './order-view';
import { carpoolShareText, claimedShareText, dispatchShareText, passengerShareText, roundTripShareText, transferShareText } from './share-text';

const ORDER_CODE_LENGTH = 10;
const CONFIRM_CODE_LENGTH = 12;
const LIST_LIMIT = 50;
/** 客人通訊錄 reads this many of the dispatcher's latest orders. */
const PASSENGER_BOOK_ORDERS = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;
/** What a driver leaves behind on an order they no longer have: their progress and a change they had to confirm. */
const CLEAR_TRIP_STATE = { departedAt: null, arrivedAt: null, pickedUpAt: null, changeSummary: null, changePendingAt: null } as const;
/** 行程進度: the field each step sets. */
const PROGRESS_FIELD = { DEPARTED: 'departedAt', ARRIVED: 'arrivedAt', PICKED_UP: 'pickedUpAt' } as const;
/** 拼車: each party's 行程進度, gone with the driver who reported it (改派, 取消接單). */
const CLEAR_PARTY_PROGRESS = { arrivedAt: null, pickedUpAt: null, noShowAt: null, droppedAt: null } as const;

/** 拼車: what a carpool brings to the order made from it. */
export interface FromCarpool {
  id: string;
}

export type ClaimResult = 'WON' | 'LOST';

type Money = { amount: number; currency: 'HKD' | 'CNY' | 'MOP' } | null | undefined;
const toMinor = (price: Money) => (price ? Math.round(price.amount * 100) : null);

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
    @Inject(CommissionService) private readonly commission: CommissionService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(GroupInvitesService) private readonly groupInvites: GroupInvitesService,
    @Inject(PaymentMethodsService) private readonly paymentMethods: PaymentMethodsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(NotificationsService) private readonly notifications: NotificationsService,
  ) {}

  async create(userId: string, input: CreateOrderInput, now = new Date(), carpool?: FromCarpool) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        // Quota, order and service fee succeed or fail together: with too few
        // credits nothing is created and no quota is used.
        const order = await this.prisma.$transaction(async (tx) => {
          // 即時單: leaves now; the time it is put out is its pickup time.
          const pickupAt = input.immediate ? now : new Date(input.pickupAt);
          // 接駁 or 往返: one order in two legs. 接駁 changes cars at the 接駁位置; 往返 comes back
          // the way it went.
          const second = input.transfer
            ? {
                kind: 'TRANSFER' as const,
                sameDriver: false,
                origin: input.transfer.place,
                destination: input.destination,
                pickupAt: new Date(input.transfer.pickupAt),
                driverPrice: input.transfer.driverPrice,
                // 接駁: one trip, one flight at either end.
                flightNo: input.flightNo,
                requiredPlates: input.transfer.requiredPlates,
                selfDriveLeg: input.transfer.selfDriveLeg,
              }
            : input.roundTrip
              ? {
                  kind: 'ROUND_TRIP' as const,
                  sameDriver: input.roundTrip.sameDriver,
                  origin: input.destination,
                  destination: input.origin,
                  pickupAt: new Date(input.roundTrip.pickupAt),
                  driverPrice: input.roundTrip.driverPrice,
                  // The way back flies on its own flight.
                  flightNo: input.roundTrip.flightNo,
                  requiredPlates: input.requiredPlates,
                  // 同一位司機來回 with 這單我自己做: the dispatcher drives both legs.
                  selfDriveLeg: input.roundTrip.sameDriver ? null : input.roundTrip.selfDriveLeg,
                }
              : null;
          if (second && second.pickupAt < pickupAt) {
            throw apiError(HttpStatus.BAD_REQUEST, 'LEG_BEFORE_PREVIOUS', 'The second leg cannot start before the first');
          }
          if (input.selfDrive || second?.selfDriveLeg) await this.requireProfile(tx, userId);
          // A 接駁 or 往返 order uses the quota and pays the service fee once, like any order.
          await this.entitlements.consume(tx, userId, FEATURES.orderCreate, now);
          const fee = await this.commission.feeFor(tx, userId, now);
          const defaults =
            input.contactRevealMinutes === undefined || input.inPool === undefined
              ? await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { contactRevealMinutes: true, poolByDefault: true } })
              : null;
          const preference = input.contactRevealMinutes === undefined ? defaults!.contactRevealMinutes : input.contactRevealMinutes;
          // 這單我自己做 is never offered to others, so it stays out of the 接單池 too. A 接駁
          // order always has a leg for others to take.
          // 即時單 goes into the 接單池 unless the dispatcher said otherwise.
          const inPool = !input.selfDrive && (input.inPool ?? (input.immediate || defaults!.poolByDefault));
          // 先給常用司機: only when the dispatcher has some, and never for an order nobody else takes,
          // nor for one that leaves too soon for anyone else to wait 30 minutes (即時單 above all).
          const favoritesFirst =
            input.favoritesFirst &&
            !input.selfDrive &&
            !input.immediate &&
            pickupAt.getTime() - now.getTime() > FAVORITES_FIRST_MIN_LEAD_MINUTES * 60_000 &&
            (await tx.driverNote.count({ where: { ownerId: userId, favorite: true } })) > 0;
          // What both legs of a 接駁 or 往返 order share: the passenger and the load.
          const common = {
            dispatcherId: userId,
            passengers: input.passengers,
            luggage: input.luggage,
            vehicleType: input.vehicleType,
            notes: input.notes,
            rawText: input.rawText,
            flightNo: input.flightNo,
            passengerName: input.passengerName,
            passengerContact: input.passengerContact,
            contactRevealMinutes: preference,
            inPool,
            showPaymentMethods: input.showPaymentMethods,
            favoritesUntil: favoritesFirst ? new Date(now.getTime() + FAVORITES_FIRST_MINUTES * 60_000) : null,
          };
          // 這單我自己做, or 這段我自己做: taken by the dispatcher at once, never offered for claiming.
          const selfDriven = { status: 'ASSIGNED' as const, claimedById: userId, claimedAt: now };
          const placed = await tx.order.create({
            data: {
              ...common,
              code: randomCode(ORDER_CODE_LENGTH),
              confirmCode: randomCode(CONFIRM_CODE_LENGTH),
              pickupAt,
              immediate: input.immediate,
              origin: input.origin,
              // The first leg of a 接駁 order ends at the 接駁位置; of a 往返, where the trip turns back.
              destination: second ? second.origin : input.destination,
              waypoints: input.waypoints,
              driverPriceMinor: toMinor(input.driverPrice),
              driverCurrency: input.driverPrice?.currency ?? 'HKD',
              // The passenger pays one price for the whole trip; it is kept on the first leg.
              passengerPriceMinor: toMinor(input.passengerPrice),
              passengerCurrency: input.passengerPrice?.currency ?? input.driverPrice?.currency ?? 'HKD',
              showPassengerPrice: input.showPassengerPrice,
              commissionMinor: fee > 0 ? fee : null,
              requiredPlates: input.requiredPlates,
              ...(input.selfDrive || second?.selfDriveLeg === 1 ? selfDriven : {}),
            },
            include: orderInclude,
          });
          if (fee > 0) await this.credits.charge(tx, userId, placed.id, fee);
          if (input.bookingId) await this.takeBooking(tx, userId, input.bookingId, placed.id);
          if (carpool) return this.takeCarpool(tx, userId, carpool.id, placed.id, now);
          if (!second) return placed;
          const journey = { journeyKind: second.kind, sameDriver: second.sameDriver };
          await tx.order.update({ where: { id: placed.id }, data: { journeyId: placed.id, legIndex: 1, ...journey } });
          await tx.order.create({
            data: {
              ...common,
              code: randomCode(ORDER_CODE_LENGTH),
              confirmCode: randomCode(CONFIRM_CODE_LENGTH),
              pickupAt: second.pickupAt,
              origin: second.origin,
              destination: second.destination,
              flightNo: second.flightNo,
              driverPriceMinor: toMinor(second.driverPrice),
              driverCurrency: second.driverPrice?.currency ?? 'HKD',
              passengerCurrency: placed.passengerCurrency,
              requiredPlates: second.requiredPlates,
              journeyId: placed.id,
              legIndex: 2,
              ...journey,
              ...(second.selfDriveLeg === 2 || (second.sameDriver && input.selfDrive) ? selfDriven : {}),
            },
          });
          return tx.order.findUniqueOrThrow({ where: { id: placed.id }, include: orderInclude });
        });
        telemetry.domain('order.create');
        // The order was read before the booking was tied to it; say so here rather than read it again.
        return this.withShareTexts(input.bookingId ? { ...order, booking: { id: input.bookingId } } : order);
      } catch (error) {
        // A random code collided with an existing one: try again with new codes.
        const collided = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!collided || attempt >= 2) throw error;
      }
    }
  }

  /**
   * 客人通訊錄: the passengers of the orders this user put out, one line per phone, most recent
   * first. Read from their own orders; nothing is kept apart, and it is theirs alone: a driver
   * who took an order never gets its passenger here.
   */
  async passengers(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { dispatcherId: userId },
      orderBy: { pickupAt: 'desc' },
      take: PASSENGER_BOOK_ORDERS,
      select: { id: true, journeyId: true, status: true, pickupAt: true, origin: true, destination: true, passengerName: true, passengerContact: true },
    });
    const book = new Map<string, { contact: string; name: string | null; trips: Set<string>; lastPickupAt: string; lastRoute: string }>();
    // 拼車: an order made from a carpool has no one passenger; its parties are each a passenger.
    const parties = await this.prisma.carpoolSeat.findMany({
      where: { status: 'CONFIRMED', carpool: { driverId: userId, order: { dispatcherId: userId } } },
      select: { passengerName: true, passengerContact: true, carpool: { select: { orderId: true } } },
    });
    const partiesOf = new Map<string, { passengerName: string; passengerContact: string }[]>();
    for (const party of parties) {
      const id = party.carpool.orderId as string;
      partiesOf.set(id, [...(partiesOf.get(id) ?? []), party]);
    }
    const passengersOf = (order: (typeof orders)[number]) =>
      partiesOf.get(order.id)?.map((party) => ({ ...order, passengerName: party.passengerName, passengerContact: party.passengerContact })) ?? [order];
    for (const order of orders.flatMap(passengersOf)) {
      if (!order.passengerContact) continue;
      const entry =
        book.get(order.passengerContact) ??
        { contact: order.passengerContact, name: null, trips: new Set<string>(), lastPickupAt: order.pickupAt.toISOString(), lastRoute: `${order.origin} → ${order.destination}` };
      // Newest first: the first name seen is the latest one given for this phone.
      entry.name ??= order.passengerName;
      // A 接駁 trip is one trip; a cancelled order is not a trip taken.
      if (order.status !== 'CANCELLED') entry.trips.add(order.journeyId ?? order.id);
      book.set(order.passengerContact, entry);
    }
    return [...book.values()].map(({ trips, ...entry }) => ({ ...entry, trips: trips.size }));
  }

  async list(userId: string, query: OrderListQuery) {
    const orders = await this.prisma.order.findMany({
      // A 接駁 order is listed once for its dispatcher, by its first leg; a driver sees the leg they took.
      where: query.role === 'dispatched' ? { dispatcherId: userId, OR: [{ journeyId: null }, { legIndex: 1 }] } : { claimedById: userId },
      orderBy: { pickupAt: 'desc' },
      take: LIST_LIMIT,
      include: orderInclude,
    });
    return orders.map((order) => toOrderView(order, viewerOf(order, userId), this.config.publicBaseUrl, new Date(), userId));
  }

  /**
   * 接單池: orders their dispatchers chose to list, still open and not yet due.
   * Only for signed-in drivers who have filled in their details, the same as
   * claiming. Each order is shown as on its claim page, so no passenger details.
   * The dispatcher's own orders are listed too, as everyone sees them, marked
   * `mine` with the id that opens their own page (they cannot claim them).
   */
  async pool(userId: string, query: PoolQuery, now = new Date()) {
    await this.requireProfile(this.prisma, userId);
    const dayStart = query.date ? new Date(`${query.date}T00:00:00+08:00`) : null;
    const dayEnd = dayStart ? { lt: new Date(dayStart.getTime() + DAY_MS) } : {};
    const later = (earliest: Date) => (dayStart && dayStart > earliest ? dayStart : earliest);
    // 即時單 left when it was put out: it stays listed while open, up to IMMEDIATE_POOL_MINUTES.
    const due: Prisma.OrderWhereInput = {
      status: 'OPEN',
      AND: [
        {
          OR: [
            { pickupAt: { gte: later(now), ...dayEnd } },
            { immediate: true, pickupAt: { gte: later(new Date(now.getTime() - IMMEDIATE_POOL_MINUTES * 60_000)), ...dayEnd } },
          ],
        },
      ],
    };
    const place = (q: string): Prisma.OrderWhereInput => ({
      OR: [{ origin: { contains: q, mode: 'insensitive' } }, { destination: { contains: q, mode: 'insensitive' } }],
    });
    const orders = await this.prisma.order.findMany({
      where: {
        inPool: true,
        scope: 'PUBLIC',
        // 先給常用司機: shown to the dispatcher's 常用司機 (and the dispatcher) until everyone may claim it.
        AND: [
          {
            OR: [
              { favoritesUntil: null },
              { favoritesUntil: { lte: now } },
              { dispatcherId: userId },
              { dispatcher: { driverNotes: { some: { driverId: userId, favorite: true } } } },
            ],
          },
        ],
        // A 接駁 order is one entry, by its first leg, while either leg is still open and due.
        OR: [
          { journeyId: null, ...due, ...(query.q ? place(query.q) : {}) },
          // The search finds either leg's places; a taken first leg still leaves the second open.
          { legIndex: 1, AND: [{ journeyLegs: { some: due } }, ...(query.q ? [{ journeyLegs: { some: place(query.q) } }] : [])] },
        ],
      },
      orderBy: { pickupAt: 'asc' },
      take: LIST_LIMIT,
      include: orderInclude,
    });
    return orders.map((order) => ({
      ...toOrderView(order, 'other', this.config.publicBaseUrl, now, userId),
      ...(order.dispatcherId === userId ? { mine: true, id: order.id } : { mine: false }),
    }));
  }

  /** An order the user dispatched or claimed, with the texts to share. */
  async getForParticipant(userId: string, id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: orderInclude });
    if (!order || viewerOf(order, userId) === 'other') throw this.notFound();
    return viewerOf(order, userId) === 'dispatcher' ? this.withShareTexts(order) : this.view(order, userId);
  }

  /** The page a driver opens from a group link. Anyone may look; only participants see contacts. */
  async getByCode(code: string, userId?: string) {
    const order = await this.prisma.order.findUnique({ where: { code }, include: orderInclude });
    if (!order) throw this.notFound();
    const [groupInvites, dispatcherCompletedTrips] = await Promise.all([
      // The dispatcher's own groups, so drivers who opened the link can join them.
      this.groupInvites.forClaimPage(order.dispatcherId),
      // Counted like the 名片頁 figure: trips the dispatcher took and finished in the tool, never typed in.
      this.prisma.order.count({ where: { claimedById: order.dispatcherId, status: 'COMPLETED' } }),
    ]);
    return { ...this.view(order, userId), groupInvites, dispatcherCompletedTrips };
  }

  /**
   * First come, first served across every group the link was posted in. The
   * conditional update is the only arbiter: of any number of simultaneous
   * claims exactly one changes the row, and every attempt is recorded.
   */
  async claim(code: string, userId: string, now = new Date()) {
    const order = await this.prisma.order.findUnique({
      where: { code },
      select: {
        id: true,
        dispatcherId: true,
        claimedById: true,
        status: true,
        scope: true,
        journeyId: true,
        journeyKind: true,
        sameDriver: true,
        favoritesUntil: true,
      },
    });
    if (!order) throw this.notFound();
    if (order.dispatcherId === userId) {
      throw apiError(HttpStatus.CONFLICT, 'CANNOT_CLAIM_OWN_ORDER', 'Dispatchers cannot claim their own order');
    }
    if (order.claimedById === userId) return this.claimResult('WON', code, userId);
    if (order.scope === 'TEAM') throw apiError(HttpStatus.FORBIDDEN, 'TEAM_ONLY', 'Only team members can claim this order');
    // 先給常用司機: everyone else waits until the dispatcher's 常用司機 have had their time.
    if (order.favoritesUntil && order.favoritesUntil > now && !(await this.isFavorite(order.dispatcherId, userId))) {
      throw apiError(HttpStatus.CONFLICT, 'FAVORITES_FIRST', 'Only the dispatcher\'s regular drivers may claim this order for now');
    }

    await this.requireProfile(this.prisma, userId);

    // 往返 同一位司機來回: one claim takes every leg still to drive, from either leg's link.
    const together = order.journeyKind === 'ROUND_TRIP' && order.sameDriver ? order.journeyId : null;
    const { result, legIds } = await this.prisma.$transaction(async (tx) => {
      // Under the order's lock, so two taps on the two legs at once cannot both go through.
      if (order.journeyId) await this.lockJourney(tx, order.journeyId);
      // 接駁: each leg is a different driver's. 往返 可分開接 lets one driver take both.
      if (order.journeyId && order.journeyKind !== 'ROUND_TRIP') {
        const other = await tx.order.count({ where: { journeyId: order.journeyId, id: { not: order.id }, claimedById: userId } });
        if (other > 0) throw apiError(HttpStatus.CONFLICT, 'ONE_LEG_PER_DRIVER', 'One driver takes one leg of a 接駁 order');
      }
      if (together) {
        // All or nothing: a leg someone else drives means the trip is taken.
        const legs = await tx.order.findMany({ where: { journeyId: together, status: { in: ['OPEN', 'ASSIGNED'] } }, select: { id: true, status: true } });
        const open = legs.filter((leg) => leg.status === 'OPEN').map((leg) => leg.id);
        if (open.length === 0 || open.length < legs.length) return { result: 'LOST' as ClaimResult, legIds: [order.id] };
        await tx.order.updateMany({
          where: { id: { in: open }, status: 'OPEN', claimedById: null },
          data: { status: 'ASSIGNED', claimedById: userId, claimedAt: now },
        });
        return { result: 'WON' as ClaimResult, legIds: open };
      }
      const updated = await tx.order.updateMany({
        where: { id: order.id, status: 'OPEN', claimedById: null },
        data: { status: 'ASSIGNED', claimedById: userId, claimedAt: now },
      });
      return { result: (updated.count === 1 ? 'WON' : 'LOST') as ClaimResult, legIds: [order.id] };
    });
    // Every attempt is kept; a won 往返 is kept on each leg, so each leg can be given back.
    await this.prisma.orderClaim.createMany({ data: legIds.map((orderId) => ({ orderId, driverId: userId, result })) });
    telemetry.domain('order.claim', result === 'WON' ? 'success' : 'lost');
    if (result === 'WON') await this.tell(order.id, 'ORDER_CLAIMED', 'dispatcher');
    return this.claimResult(result, code, userId);
  }

  /**
   * Cancelling returns the service fee, in the same transaction. A 接駁 order is cancelled whole:
   * every leg not yet over, from either leg's page, with its one fee returned once. To replace
   * one leg's driver the dispatcher uses 改派 instead.
   */
  async cancel(userId: string, id: string, now = new Date()) {
    const order = await this.prisma.order.findFirst({ where: { id, dispatcherId: userId }, select: { journeyId: true } });
    const journeyId = order?.journeyId;
    if (!journeyId) {
      const view = await this.transition(userId, id, ['OPEN', 'ASSIGNED'], { status: 'CANCELLED', cancelledAt: now }, 'dispatcher', async (tx) => {
        await this.credits.refundOrder(tx, id);
        // 拼車: the carpool goes with its order.
        await tx.carpool.updateMany({ where: { orderId: id }, data: { status: 'CANCELLED', cancelledAt: now } });
      });
      await this.tell(id, 'ORDER_CANCELLED', 'driver');
      telemetry.domain('order.cancel');
      return view;
    }
    const cancelled = await this.prisma.$transaction(async (tx) => {
      await this.lockJourney(tx, journeyId);
      const legs = await tx.order.findMany({ where: { journeyId, status: { in: ['OPEN', 'ASSIGNED'] } }, select: { id: true } });
      if (legs.length === 0) throw this.invalidStatus();
      await tx.order.updateMany({ where: { id: { in: legs.map((leg) => leg.id) } }, data: { status: 'CANCELLED', cancelledAt: now } });
      await this.credits.refundOrder(tx, journeyId);
      return legs;
    });
    for (const leg of cancelled) await this.tell(leg.id, 'ORDER_CANCELLED', 'driver');
    telemetry.domain('order.cancel');
    return this.getForParticipant(userId, id);
  }

  /** 代為取消 by the platform's staff: the dispatcher's own cancel, and the dispatcher is told. */
  async cancelForStaff(dispatcherId: string, id: string, now = new Date()) {
    const view = await this.cancel(dispatcherId, id, now);
    await this.tell(id, 'ORDER_CANCELLED_BY_STAFF', 'dispatcher');
    return view;
  }

  /**
   * "改派": take the order back from the driver and open it for claiming again. 往返 同一位司機來回
   * takes back every leg still to drive, as one claim took them.
   */
  async reopen(userId: string, id: string) {
    const before = await this.prisma.order.findFirst({
      where: { id, dispatcherId: userId },
      select: { claimedById: true, journeyId: true, journeyKind: true, sameDriver: true },
    });
    if (before?.journeyId && before.journeyKind === 'ROUND_TRIP' && before.sameDriver) {
      const journeyId = before.journeyId;
      const legs = await this.prisma.$transaction(async (tx) => {
        await this.lockJourney(tx, journeyId);
        const taken = await tx.order.findMany({ where: { journeyId, status: 'ASSIGNED' }, select: { id: true, claimedById: true } });
        if (taken.length === 0) throw this.invalidStatus();
        await tx.order.updateMany({
          where: { id: { in: taken.map((leg) => leg.id) } },
          data: { status: 'OPEN', claimedById: null, claimedAt: null, passengerConfirmedAt: null, settledAt: null, ...CLEAR_TRIP_STATE },
        });
        for (const leg of taken) await this.clearPartyProgress(tx, leg.id);
        return taken;
      });
      // One notice for the trip, to the driver who had it.
      await this.tell(legs[0].id, 'ORDER_REOPENED', 'driver', legs[0].claimedById);
      return this.getForParticipant(userId, id);
    }
    const view = await this.transition(
      userId,
      id,
      ['ASSIGNED'],
      { status: 'OPEN', claimedById: null, claimedAt: null, passengerConfirmedAt: null, settledAt: null, ...CLEAR_TRIP_STATE },
      'dispatcher',
      (tx) => this.clearPartyProgress(tx, id),
    );
    await this.tell(id, 'ORDER_REOPENED', 'driver', before?.claimedById);
    return view;
  }

  /**
   * 取消接單: the driver gives the order back, or with 接駁 only their own leg; it is open for
   * claiming again on the same link and the dispatcher is told. Allowed until the trip is done.
   */
  async release(userId: string, id: string) {
    const order = await this.prisma.order.findFirst({
      where: { id, claimedById: userId },
      select: { code: true, dispatcherId: true, journeyId: true, journeyKind: true, sameDriver: true },
    });
    if (!order) throw this.notFound();
    // 這單我自己做 is the dispatcher's own: they hand it over with 交給別的司機 instead.
    if (order.dispatcherId === userId) throw this.invalidStatus();
    // 往返 同一位司機來回: the driver gives back every leg still to drive, as they took them.
    const together = order.journeyId && order.journeyKind === 'ROUND_TRIP' && order.sameDriver ? order.journeyId : null;
    const released = await this.prisma.$transaction(async (tx) => {
      // 接駁 and 往返: under the order's lock, as a claim on either leg is.
      if (order.journeyId) await this.lockJourney(tx, order.journeyId);
      const legIds = together
        ? (await tx.order.findMany({ where: { journeyId: together, claimedById: userId, status: 'ASSIGNED' }, select: { id: true } })).map((leg) => leg.id)
        : [id];
      const moved = await tx.order.updateMany({
        where: { id: { in: legIds }, claimedById: userId, status: 'ASSIGNED' },
        data: { status: 'OPEN', claimedById: null, claimedAt: null, passengerConfirmedAt: null, settledAt: null, ...CLEAR_TRIP_STATE },
      });
      // 我的司機 counts how often a driver gave an order back: the claim they won is marked.
      if (moved.count > 0) {
        for (const legId of legIds) {
          await this.clearPartyProgress(tx, legId);
          const won = await tx.orderClaim.findFirst({
            where: { orderId: legId, driverId: userId, result: 'WON', releasedAt: null },
            orderBy: { createdAt: 'desc' },
            select: { id: true },
          });
          if (won) await tx.orderClaim.update({ where: { id: won.id }, data: { releasedAt: new Date() } });
        }
      }
      return moved;
    });
    if (released.count === 0) throw this.invalidStatus();
    await this.tell(id, 'ORDER_RELEASED', 'dispatcher');
    telemetry.domain('order.release');
    return this.getByCode(order.code, userId);
  }

  /**
   * 行程進度: the driver who took the order says they set out, reached the pickup, and have the
   * passenger on board. Each step is kept once, with its time; the dispatcher and the passenger see them.
   */
  async progress(userId: string, id: string, input: OrderProgress, now = new Date()) {
    const field = PROGRESS_FIELD[input.step];
    // 拼車: 已到上車點 and 已上車 are each party's, reported with partyProgress.
    if (input.step !== 'DEPARTED' && (await this.prisma.carpool.count({ where: { orderId: id } })) > 0) {
      throw apiError(HttpStatus.CONFLICT, 'CARPOOL_PROGRESS_BY_PARTY', 'Report each party of a carpool on its own');
    }
    const moved = await this.prisma.order.updateMany({
      where: { id, claimedById: userId, status: 'ASSIGNED', [field]: null },
      data: { [field]: now },
    });
    if (moved.count === 0) {
      const row = await this.prisma.order.findFirst({ where: { id, claimedById: userId }, select: { status: true } });
      if (!row) throw this.notFound();
      if (row.status !== 'ASSIGNED') throw this.invalidStatus();
      // Already reported: the first time stands.
    } else {
      telemetry.domain('order.progress');
    }
    return this.getForParticipant(userId, id);
  }

  /**
   * 修改行程: the dispatcher changes time, places or load after putting the order out. With 接駁 the
   * time is the leg's own, the places are the trip's ends and its 接駁位置, and the load is the
   * whole trip's. A driver who already took a changed leg is told and confirms with 知道了.
   */
  async updateTrip(userId: string, id: string, input: UpdateTripInput, now = new Date()) {
    const order = await this.prisma.order.findFirst({ where: { id, dispatcherId: userId }, select: { status: true, journeyId: true, journeyKind: true } });
    if (!order) throw this.notFound();
    if (order.status !== 'OPEN' && order.status !== 'ASSIGNED') throw this.invalidStatus();
    const roundTrip = order.journeyKind === 'ROUND_TRIP';
    // 拼車: the parties' seats made the trip; to change it, the carpool is opened again.
    if ((await this.prisma.carpool.count({ where: { orderId: id } })) > 0) {
      throw apiError(HttpStatus.CONFLICT, 'CARPOOL_TRIP_FIXED', 'A carpool order keeps the trip its passengers asked for');
    }
    if (input.transferPlace !== undefined && (!order.journeyId || roundTrip)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'NOT_A_TRANSFER', 'Only a 接駁 order has a 接駁位置');
    }
    const told = await this.prisma.$transaction(async (tx) => {
      if (order.journeyId) await this.lockJourney(tx, order.journeyId);
      const legs = order.journeyId
        ? await tx.order.findMany({ where: { journeyId: order.journeyId }, orderBy: { legIndex: 'asc' } })
        : [await tx.order.findUniqueOrThrow({ where: { id } })];
      const changes = new Map(legs.map((leg) => [leg.id, { data: {} as Prisma.OrderUncheckedUpdateInput, what: [] as string[] }]));
      const put = (leg: (typeof legs)[number], field: keyof typeof leg, value: unknown, label: string) => {
        const before = leg[field];
        const same = before instanceof Date && value instanceof Date ? before.getTime() === value.getTime() : before === value;
        if (same) return;
        const change = changes.get(leg.id)!;
        (change.data as Record<string, unknown>)[field] = value;
        if (!change.what.includes(label)) change.what.push(label);
      };
      const first = legs[0];
      const last = legs[legs.length - 1];
      if (input.pickupAt !== undefined) {
        const leg = legs.find((candidate) => candidate.id === id)!;
        put(leg, 'pickupAt', new Date(input.pickupAt), '時間');
        // A time set by hand makes a 即時單 an ordinary order.
        const data = changes.get(leg.id)!.data as Record<string, unknown>;
        if ('pickupAt' in data) data.immediate = false;
      }
      if (input.origin !== undefined) put(first, 'origin', input.origin, '上車地點');
      if (input.destination !== undefined) put(roundTrip ? first : last, 'destination', input.destination, '目的地');
      // 往返: the way back runs from the destination to where the trip started.
      if (roundTrip && legs.length > 1) {
        if (input.destination !== undefined) put(legs[1], 'origin', input.destination, '上車地點');
        if (input.origin !== undefined) put(legs[1], 'destination', input.origin, '目的地');
      }
      if (input.transferPlace !== undefined && legs.length > 1) {
        put(first, 'destination', input.transferPlace, '接駁位置');
        put(legs[1], 'origin', input.transferPlace, '接駁位置');
      }
      for (const leg of legs) {
        if (input.passengers !== undefined) put(leg, 'passengers', input.passengers, '人數');
        if (input.luggage !== undefined) put(leg, 'luggage', input.luggage, '行李');
        if (input.vehicleType !== undefined) put(leg, 'vehicleType', input.vehicleType, '車型');
        if (input.notes !== undefined) put(leg, 'notes', input.notes || null, '備註');
        // 往返: each leg has its own flight, so the flight changes on this leg only.
        if (input.flightNo !== undefined && (!roundTrip || leg.id === id)) put(leg, 'flightNo', input.flightNo || null, '航班');
      }
      // The second leg still starts after the first: at the 接駁位置, or on the way back.
      if (legs.length > 1) {
        const timeOf = (leg: (typeof legs)[number]) => (changes.get(leg.id)!.data.pickupAt as Date | undefined) ?? leg.pickupAt;
        if (timeOf(legs[1]) < timeOf(first)) {
          throw apiError(HttpStatus.BAD_REQUEST, 'LEG_BEFORE_PREVIOUS', 'The second leg cannot start before the first');
        }
      }
      const toTell: string[] = [];
      for (const leg of legs) {
        const change = changes.get(leg.id)!;
        if (change.what.length === 0 || (leg.status !== 'OPEN' && leg.status !== 'ASSIGNED')) continue;
        const driverHasIt = leg.status === 'ASSIGNED' && leg.claimedById && leg.claimedById !== userId;
        if (driverHasIt) {
          // Changes not yet confirmed add up, so the driver reads them all at once.
          const pending = leg.changePendingAt && leg.changeSummary ? leg.changeSummary.split('、') : [];
          change.data.changeSummary = [...new Set([...pending, ...change.what])].join('、');
          change.data.changePendingAt = now;
          toTell.push(leg.id);
        }
        await tx.order.update({ where: { id: leg.id }, data: change.data });
      }
      if ([...changes.values()].every((change) => change.what.length === 0)) {
        throw apiError(HttpStatus.BAD_REQUEST, 'NOTHING_CHANGED', 'Nothing in the trip changed');
      }
      return toTell;
    });
    for (const legId of told) await this.tell(legId, 'ORDER_CHANGED', 'driver');
    telemetry.domain('order.change');
    return this.getForParticipant(userId, id);
  }

  /** 知道了: the driver confirms the dispatcher's change to the trip they took; the dispatcher is told. */
  async ackChange(userId: string, id: string) {
    const moved = await this.prisma.order.updateMany({
      where: { id, claimedById: userId, changePendingAt: { not: null } },
      data: { changePendingAt: null, changeSummary: null },
    });
    if (moved.count === 0) {
      const mine = await this.prisma.order.count({ where: { id, claimedById: userId } });
      throw mine ? this.invalidStatus() : this.notFound();
    }
    await this.tell(id, 'ORDER_CHANGE_ACKED', 'dispatcher');
    return this.getForParticipant(userId, id);
  }

  /**
   * 我的司機: the drivers who took this dispatcher's orders (and any they marked), with how many
   * they took, finished and gave back, and the dispatcher's own mark and note. Only for them.
   */
  async drivers(userId: string) {
    const [claims, notes] = await Promise.all([
      this.prisma.orderClaim.findMany({
        where: { result: 'WON', driverId: { not: userId }, order: { dispatcherId: userId } },
        select: {
          driverId: true,
          releasedAt: true,
          createdAt: true,
          order: { select: { id: true, journeyId: true, journeyKind: true, sameDriver: true, status: true, claimedById: true } },
        },
      }),
      this.prisma.driverNote.findMany({ where: { ownerId: userId } }),
    ]);
    const ids = [...new Set([...claims.map((claim) => claim.driverId), ...notes.map((note) => note.driverId)])];
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        countryCode: true,
        phone: true,
        profile: { select: { name: true, vehicleType: true, hkPlate: true, macauPlate: true, mainlandPlate: true } },
      },
    });
    return users
      .map((user) => {
        // 往返 同一位司機來回 is one job on two legs: counted once, by its first leg's claim.
        const theirs = claims.filter(
          (claim) =>
            claim.driverId === user.id &&
            !(claim.order.journeyKind === 'ROUND_TRIP' && claim.order.sameDriver && claim.order.journeyId !== claim.order.id),
        );
        const note = notes.find((one) => one.driverId === user.id);
        const lastAt = theirs.reduce<Date | null>((latest, claim) => (!latest || claim.createdAt > latest ? claim.createdAt : latest), null);
        return {
          id: user.id,
          name: user.profile?.name ?? null,
          phone: `${user.countryCode} ${user.phone}`,
          vehicleType: user.profile?.vehicleType ?? null,
          plates: [user.profile?.hkPlate, user.profile?.macauPlate, user.profile?.mainlandPlate].filter((plate): plate is string => Boolean(plate)),
          taken: theirs.filter((claim) => !claim.releasedAt).length,
          completed: theirs.filter((claim) => !claim.releasedAt && claim.order.status === 'COMPLETED' && claim.order.claimedById === user.id).length,
          released: theirs.filter((claim) => claim.releasedAt).length,
          lastAt: lastAt?.toISOString() ?? null,
          favorite: note?.favorite ?? false,
          note: note?.note ?? null,
        };
      })
      .sort((a, b) => Number(b.favorite) - Number(a.favorite) || (b.lastAt ?? '').localeCompare(a.lastAt ?? ''));
  }

  /** 常用司機 and a private note, only on a driver who took one of the dispatcher's orders. */
  async updateDriverNote(userId: string, driverId: string, input: DriverNoteUpdate) {
    const known = await this.prisma.orderClaim.count({ where: { driverId, result: 'WON', order: { dispatcherId: userId } } });
    if (driverId === userId || (!known && !(await this.prisma.driverNote.count({ where: { ownerId: userId, driverId } })))) {
      throw apiError(HttpStatus.NOT_FOUND, 'DRIVER_NOT_FOUND', 'Not a driver who took your orders');
    }
    const data = {
      ...(input.favorite !== undefined ? { favorite: input.favorite } : {}),
      ...(input.note !== undefined ? { note: input.note || null } : {}),
    };
    await this.prisma.driverNote.upsert({
      where: { ownerId_driverId: { ownerId: userId, driverId } },
      create: { ownerId: userId, driverId, ...data },
      update: data,
    });
    return (await this.drivers(userId)).find((driver) => driver.id === driverId);
  }

  /** Whether `driverId` is one of `ownerId`'s 常用司機. */
  private async isFavorite(ownerId: string, driverId: string) {
    return (await this.prisma.driverNote.count({ where: { ownerId, driverId, favorite: true } })) > 0;
  }

  /** Either side marks the trip done; the other side is told. */
  async complete(userId: string, id: string, now = new Date()) {
    const view = await this.transition(userId, id, ['ASSIGNED'], { status: 'COMPLETED', completedAt: now }, 'participant');
    await this.tell(id, 'ORDER_COMPLETED', view.viewer === 'dispatcher' ? 'driver' : 'dispatcher');
    telemetry.domain('order.complete');
    return view;
  }

  /**
   * The dispatcher changes prices or whether the passenger sees theirs. The
   * driver price is locked once a driver has claimed at that price.
   */
  async updatePrices(userId: string, id: string, input: UpdateOrderPricesInput) {
    const order = await this.prisma.order.findFirst({ where: { id, dispatcherId: userId }, select: { status: true, legIndex: true } });
    if (!order) throw this.notFound();
    if (order.status === 'CANCELLED' || order.status === 'COMPLETED') throw this.invalidStatus();
    // 接駁: the passenger pays one price for the whole order, kept on its first leg.
    if ((order.legIndex ?? 1) > 1 && (input.passengerPrice !== undefined || input.showPassengerPrice !== undefined)) {
      throw apiError(HttpStatus.CONFLICT, 'TRIP_PRICE_ON_FIRST_LEG', 'The passenger price of a 接駁 order is set on its first leg');
    }
    if (input.driverPrice !== undefined && order.status !== 'OPEN') {
      throw apiError(HttpStatus.CONFLICT, 'DRIVER_PRICE_LOCKED', 'The driver price cannot change after the order is claimed');
    }
    const data: Prisma.OrderUncheckedUpdateManyInput = {};
    if (input.driverPrice !== undefined) {
      data.driverPriceMinor = toMinor(input.driverPrice);
      if (input.driverPrice) data.driverCurrency = input.driverPrice.currency;
    }
    if (input.passengerPrice !== undefined) {
      data.passengerPriceMinor = toMinor(input.passengerPrice);
      if (input.passengerPrice) data.passengerCurrency = input.passengerPrice.currency;
    }
    if (input.showPassengerPrice !== undefined) data.showPassengerPrice = input.showPassengerPrice;
    // The status condition closes the race with a claim landing in between.
    const statusGuard: Prisma.OrderWhereInput =
      input.driverPrice !== undefined ? { status: 'OPEN' } : { status: { in: ['OPEN', 'ASSIGNED'] } };
    const updated = await this.prisma.order.updateMany({ where: { id, dispatcherId: userId, ...statusGuard }, data });
    if (updated.count === 0) {
      throw apiError(HttpStatus.CONFLICT, 'DRIVER_PRICE_LOCKED', 'The order changed while updating; reload and try again');
    }
    return this.getForParticipant(userId, id);
  }

  /** The dispatcher moves the time the driver sees the passenger's contact; it applies at once. */
  async setContactReveal(userId: string, id: string, input: ContactRevealUpdate) {
    return this.transition(userId, id, ['OPEN', 'ASSIGNED'], { contactRevealMinutes: input.contactRevealMinutes }, 'dispatcher');
  }

  /** The dispatcher lists the order in the 接單池 or takes it out; it applies at once. */
  async setPool(userId: string, id: string, input: PoolUpdate) {
    return this.transition(userId, id, ['OPEN'], { inPool: input.inPool }, 'dispatcher');
  }

  /**
   * 收款: the dispatcher shows their ways to be paid on the passenger's page, and marks the fare
   * received after checking their own account. A trip with 接駁 is paid once, so both apply to
   * every leg. Not for a cancelled order.
   */
  async setPayment(userId: string, id: string, input: OrderPaymentUpdate, now = new Date()) {
    const order = await this.prisma.order.findFirst({ where: { id, dispatcherId: userId }, select: { journeyId: true, status: true } });
    if (!order) throw this.notFound();
    if (order.status === 'CANCELLED') throw this.invalidStatus();
    const trip: Prisma.OrderWhereInput = order.journeyId ? { journeyId: order.journeyId } : { id };
    await this.prisma.order.updateMany({
      where: { ...trip, dispatcherId: userId },
      data: {
        ...(input.showPaymentMethods === undefined ? {} : { showPaymentMethods: input.showPaymentMethods }),
        ...(input.paid === undefined ? {} : { paidAt: input.paid ? now : null }),
      },
    });
    return this.getForParticipant(userId, id);
  }

  /**
   * 已結清: the dispatcher marks the account with the driver of a finished order as settled,
   * or takes the mark back. Each leg of a 接駁 trip has its own driver, so each is marked on
   * its own. Not for 這單我自己做: there is nobody to settle with.
   */
  async setSettlement(userId: string, id: string, input: OrderSettlementUpdate, now = new Date()) {
    const order = await this.prisma.order.findFirst({
      where: { id, dispatcherId: userId },
      select: { status: true, dispatcherId: true, claimedById: true },
    });
    if (!order) throw this.notFound();
    if (order.status !== 'COMPLETED' || !order.claimedById || order.claimedById === order.dispatcherId) throw this.invalidStatus();
    await this.prisma.order.update({ where: { id }, data: { settledAt: input.settled ? now : null } });
    if (input.settled) await this.tell(id, 'ORDER_SETTLED', 'driver');
    return this.getForParticipant(userId, id);
  }

  /**
   * 行程群: the dispatcher gives the trip a group they made themselves (a WhatsApp invite link
   * or a WeChat group QR), replaces it, or takes it away. One for the whole trip.
   */
  async setTripGroup(userId: string, id: string, input: TripGroupUpdate, now = new Date()) {
    const order = await this.prisma.order.findFirst({ where: { id, dispatcherId: userId }, select: { journeyId: true, status: true } });
    if (!order) throw this.notFound();
    if (order.status === 'CANCELLED') throw this.invalidStatus();
    const orderId = order.journeyId ?? id;
    if (input.platform === null) {
      await this.prisma.tripGroup.deleteMany({ where: { orderId } });
    } else if (input.platform === 'WHATSAPP') {
      const data = { platform: input.platform, inviteUrl: input.inviteUrl, qrImage: null, qrMime: null, expiresAt: null };
      await this.prisma.tripGroup.upsert({ where: { orderId }, create: { orderId, ...data }, update: data });
    } else {
      const image = decodeQrImage(input.qrImage);
      if (!image) throw apiError(HttpStatus.BAD_REQUEST, 'QR_IMAGE_INVALID', 'Upload a PNG, JPEG or WebP image up to 400 KB');
      const data = {
        platform: input.platform,
        inviteUrl: null,
        qrImage: image.bytes,
        qrMime: image.mime,
        expiresAt: new Date(now.getTime() + WECHAT_GROUP_QR_DAYS * 24 * 60 * 60 * 1000),
      };
      await this.prisma.tripGroup.upsert({ where: { orderId }, create: { orderId, ...data }, update: data });
    }
    return this.getForParticipant(userId, id);
  }

  /**
   * The WeChat QR of a trip's group, for whoever the view offered it to: the dispatcher, the
   * driver once they may see the passenger's contact, or the passenger through their link.
   */
  async tripGroupQr(by: { userId: string; id: string } | { confirmCode: string }, now = new Date()) {
    const order = await this.prisma.order.findFirst({
      where: 'confirmCode' in by ? { confirmCode: by.confirmCode } : { id: by.id, OR: [{ dispatcherId: by.userId }, { claimedById: by.userId }] },
      select: { id: true, journeyId: true, status: true, dispatcherId: true, pickupAt: true, contactRevealMinutes: true },
    });
    if (!order || order.status === 'CANCELLED') return null;
    if ('userId' in by && order.dispatcherId !== by.userId) {
      const revealAt = contactRevealAt(order);
      if (order.status === 'COMPLETED' || (revealAt && now < revealAt)) return null;
    }
    // The passenger's page stops offering the group once the whole trip is over.
    if ('confirmCode' in by) {
      const trip = order.journeyId ?? order.id;
      const legs = await this.prisma.order.findMany({
        where: { OR: [{ id: trip }, { journeyId: trip }], status: { not: 'CANCELLED' } },
        select: { status: true },
      });
      if (legs.length > 0 && legs.every((leg) => leg.status === 'COMPLETED')) return null;
    }
    const group = await this.prisma.tripGroup.findUnique({ where: { orderId: order.journeyId ?? order.id } });
    if (!group?.qrImage || !group.qrMime || (group.expiresAt && group.expiresAt <= now)) return null;
    return { mime: group.qrMime, bytes: Buffer.from(group.qrImage) };
  }

  async getForPassenger(confirmCode: string) {
    const order = await this.prisma.order.findUnique({ where: { confirmCode }, include: orderInclude });
    if (!order) throw this.notFound();
    const view = toPassengerView(order);
    return { ...view, payment: view.status === 'CANCELLED' ? null : await this.paymentFor(order, confirmCode) };
  }

  /**
   * The payment section of the passenger's page: who to pay, how much and how. Only when the
   * dispatcher turned it on and has ways to be paid. The amount is the passenger price; for a
   * trip, the sum of its legs when every leg still on has one in the same currency.
   */
  private async paymentFor(order: OrderWithPeople, confirmCode: string) {
    if (!order.showPaymentMethods) return null;
    const methods = await this.paymentMethods.forPassenger(order.dispatcherId, confirmCode);
    if (methods.length === 0) return null;
    // A 接駁 order keeps its one passenger price on the first leg; the other leg has none.
    const legs = legsOf(order)?.filter((leg) => leg.status !== 'CANCELLED') ?? [order];
    const prices = legs.map(passengerPriceOf).filter((price) => price !== null);
    const sameCurrency = prices.every((price) => price.currency === prices[0].currency);
    const amount =
      prices.length > 0 && sameCurrency
        ? { amount: Math.round(prices.reduce((sum, price) => sum + price.amount * 100, 0)) / 100, currency: prices[0].currency }
        : null;
    return {
      payee: order.dispatcher.profile?.name ?? null,
      amount,
      paid: Boolean(order.paidAt),
      methods,
    };
  }

  /** One confirmation covers every leg of a trip with 接駁 that is still on. */
  async confirmByPassenger(confirmCode: string, now = new Date()) {
    const order = await this.prisma.order.findUnique({ where: { confirmCode }, select: { id: true, journeyId: true } });
    if (!order) throw this.notFound();
    const trip: Prisma.OrderWhereInput = order.journeyId ? { journeyId: order.journeyId } : { id: order.id };
    const live = await this.prisma.order.count({ where: { ...trip, status: { not: 'CANCELLED' } } });
    if (live === 0) throw this.invalidStatus();
    const confirmed = await this.prisma.order.updateMany({
      where: { ...trip, status: { in: ['OPEN', 'ASSIGNED'] }, passengerConfirmedAt: null },
      data: { passengerConfirmedAt: now },
    });
    // Once for the trip, on the leg whose link the passenger has.
    if (confirmed.count > 0) {
      await this.tell(order.id, 'ORDER_CONFIRMED', 'dispatcher');
      telemetry.domain('order.confirm');
    }
    return this.getForPassenger(confirmCode);
  }

  /**
   * 名片頁: marks the dispatcher's own booking request as made into this
   * order. A request that is not theirs, or was already answered for good,
   * stops the order from being created at all.
   */
  private async takeBooking(tx: Prisma.TransactionClient, userId: string, bookingId: string, orderId: string) {
    const taken = await tx.bookingRequest.updateMany({
      where: { id: bookingId, page: { userId }, orderId: null, status: { in: ['PENDING', 'QUOTED', 'ACCEPTED'] } },
      data: { status: 'ORDERED', orderId },
    });
    if (taken.count === 0) throw apiError(HttpStatus.CONFLICT, 'BOOKING_NOT_OPEN', 'The booking request is no longer open');
  }

  /**
   * 拼車: ties the carpool to the order made from it, in the same transaction. The carpool must
   * be the dispatcher's own and not yet made into an order; under its lock no seat changes
   * meanwhile, so the order's load is its confirmed parties' at this moment. The parties already
   * confirmed their seats, so the order counts as confirmed by its passengers.
   */
  private async takeCarpool(tx: Prisma.TransactionClient, userId: string, carpoolId: string, orderId: string, now: Date) {
    await tx.$queryRaw`SELECT "id" FROM "Carpool" WHERE "id" = ${carpoolId} FOR UPDATE`;
    const taken = await tx.carpool.updateMany({
      where: { id: carpoolId, driverId: userId, orderId: null, status: { in: ['OPEN', 'CLOSED'] } },
      data: { status: 'ORDERED', orderId },
    });
    if (taken.count === 0) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_NOT_OPEN', 'The carpool is no longer open');
    const load = await tx.carpoolSeat.aggregate({ where: { carpoolId, status: 'CONFIRMED' }, _sum: { passengers: true, luggage: true }, _count: true });
    if (load._count === 0) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_NO_PASSENGERS', 'No confirmed passengers');
    return tx.order.update({
      where: { id: orderId },
      data: { passengers: load._sum.passengers ?? 0, luggage: load._sum.luggage ?? 0, passengerConfirmedAt: now },
      include: orderInclude,
    });
  }

  private async clearPartyProgress(tx: Prisma.TransactionClient, orderId: string) {
    await tx.carpoolSeat.updateMany({ where: { carpool: { orderId } }, data: CLEAR_PARTY_PROGRESS });
  }

  /**
   * 拼車: the driver of a carpool order reports one party's part of the trip. 乘客沒出現 waits for
   * the carpool's 等候時間 after reaching that party's pickup; 已下車 follows 已上車. The order's
   * own 已到上車點 is the first party reached, and 乘客已上車 is every party on board or not there.
   */
  async partyProgress(userId: string, id: string, seatId: string, input: CarpoolSeatProgress, now = new Date()) {
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findFirst({ where: { id, claimedById: userId }, select: { status: true, arrivedAt: true, pickedUpAt: true } });
      if (!order) throw this.notFound();
      if (order.status !== 'ASSIGNED') throw this.invalidStatus();
      const party = await tx.carpoolSeat.findFirst({
        where: { id: seatId, status: 'CONFIRMED', carpool: { orderId: id } },
        include: { carpool: { select: { waitMinutes: true } } },
      });
      if (!party) throw apiError(HttpStatus.NOT_FOUND, 'CARPOOL_SEAT_NOT_FOUND', 'Party not found');
      const set = (data: Prisma.CarpoolSeatUncheckedUpdateInput) => tx.carpoolSeat.update({ where: { id: party.id }, data });
      if (input.step === 'ARRIVED') {
        if (!party.arrivedAt) await set({ arrivedAt: now });
      } else if (input.step === 'PICKED_UP') {
        if (party.noShowAt) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_PARTY_NO_SHOW', 'This party was marked as not there');
        if (!party.pickedUpAt) await set({ pickedUpAt: now, arrivedAt: party.arrivedAt ?? now });
      } else if (input.step === 'NO_SHOW') {
        if (party.pickedUpAt) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_PARTY_ON_BOARD', 'This party is on board');
        const waited = party.arrivedAt ? now.getTime() - party.arrivedAt.getTime() : -1;
        if (waited < party.carpool.waitMinutes * 60_000) {
          throw apiError(HttpStatus.CONFLICT, 'CARPOOL_WAIT_FIRST', 'Wait at the pickup first', {
            from: party.arrivedAt ? new Date(party.arrivedAt.getTime() + party.carpool.waitMinutes * 60_000).toISOString() : null,
          });
        }
        if (!party.noShowAt) await set({ noShowAt: now });
      } else {
        if (!party.pickedUpAt) throw apiError(HttpStatus.CONFLICT, 'CARPOOL_PARTY_NOT_ON_BOARD', 'This party is not on board yet');
        if (!party.droppedAt) await set({ droppedAt: now });
      }
      const parties = await tx.carpoolSeat.findMany({ where: { carpool: { orderId: id }, status: 'CONFIRMED' }, select: { arrivedAt: true, pickedUpAt: true, noShowAt: true } });
      const data: Prisma.OrderUncheckedUpdateInput = {};
      if (!order.arrivedAt && parties.some((one) => one.arrivedAt)) data.arrivedAt = now;
      if (!order.pickedUpAt && parties.every((one) => one.pickedUpAt || one.noShowAt) && parties.some((one) => one.pickedUpAt)) data.pickedUpAt = now;
      if (Object.keys(data).length > 0) await tx.order.update({ where: { id }, data });
    });
    telemetry.domain('carpool.progress');
    return this.getForParticipant(userId, id);
  }

  /** 拼車: 已收款 for one party, marked by the dispatcher after checking their own account. */
  async partyPayment(userId: string, id: string, seatId: string, input: CarpoolSeatPayment, now = new Date()) {
    const order = await this.prisma.order.findFirst({ where: { id, dispatcherId: userId }, select: { status: true } });
    if (!order) throw this.notFound();
    if (order.status === 'CANCELLED') throw this.invalidStatus();
    const marked = await this.prisma.carpoolSeat.updateMany({
      where: { id: seatId, status: 'CONFIRMED', carpool: { orderId: id } },
      data: { paidAt: input.paid ? now : null },
    });
    if (marked.count === 0) throw apiError(HttpStatus.NOT_FOUND, 'CARPOOL_SEAT_NOT_FOUND', 'Party not found');
    return this.getForParticipant(userId, id);
  }

  /**
   * 拼車: a party left a carpool that is already an order. The order's load follows its parties,
   * and a driver who took it confirms the change with 知道了, as with 修改行程.
   */
  async carpoolPartiesChanged(orderId: string, now = new Date()) {
    const told = await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.findUnique({
        where: { id: orderId },
        select: { status: true, claimedById: true, dispatcherId: true, changePendingAt: true, changeSummary: true },
      });
      if (!order || (order.status !== 'OPEN' && order.status !== 'ASSIGNED')) return false;
      const load = await tx.carpoolSeat.aggregate({ where: { carpool: { orderId }, status: 'CONFIRMED' }, _sum: { passengers: true, luggage: true } });
      const driverHasIt = order.status === 'ASSIGNED' && order.claimedById !== null && order.claimedById !== order.dispatcherId;
      const pending = order.changePendingAt && order.changeSummary ? order.changeSummary.split('、') : [];
      await tx.order.update({
        where: { id: orderId },
        data: {
          // An order keeps at least one passenger; the dispatcher cancels it when nobody is left.
          passengers: Math.max(1, load._sum.passengers ?? 0),
          luggage: load._sum.luggage ?? 0,
          ...(driverHasIt ? { changeSummary: [...new Set([...pending, '乘客'])].join('、'), changePendingAt: now } : {}),
        },
      });
      return driverHasIt;
    });
    if (told) await this.tell(orderId, 'ORDER_CHANGED', 'driver');
  }

  /**
   * Claiming and cancelling the legs of one 接駁 order take turns on the first leg's row, so one
   * driver never ends up with both legs and a cancel never misses a leg claimed at that moment.
   */
  private async lockJourney(tx: Prisma.TransactionClient, journeyId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${journeyId} FOR UPDATE`;
  }

  /**
   * Tells the dispatcher or the driver of an order what happened to it. A driver is told only
   * when they are not the dispatcher (這單我自己做 has nobody else to tell). `driverId` names a
   * driver the order no longer has (改派).
   */
  private async tell(orderId: string, kind: NotificationKind, to: 'dispatcher' | 'driver', driverId?: string | null) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, origin: true, destination: true, pickupAt: true, dispatcherId: true, claimedById: true },
    });
    if (!order) return;
    if (to === 'dispatcher') {
      return this.notifications.send({ userId: order.dispatcherId, kind, group: 'DISPATCHED', order });
    }
    const driver = driverId === undefined ? order.claimedById : driverId;
    if (!driver || driver === order.dispatcherId) return;
    await this.notifications.send({ userId: driver, kind, group: 'CLAIMED', order });
  }

  private async requireProfile(db: Prisma.TransactionClient, userId: string) {
    const profile = await db.driverProfile.findUnique({ where: { userId }, select: { userId: true } });
    if (!profile) throw apiError(HttpStatus.CONFLICT, 'PROFILE_REQUIRED', 'Fill in your driver details first');
  }

  private async transition(
    userId: string,
    id: string,
    from: OrderStatus[],
    data: Prisma.OrderUncheckedUpdateManyInput,
    who: 'dispatcher' | 'participant',
    afterChange?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const owner: Prisma.OrderWhereInput =
      who === 'dispatcher' ? { dispatcherId: userId } : { OR: [{ dispatcherId: userId }, { claimedById: userId }] };
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.order.updateMany({ where: { id, status: { in: from }, ...owner }, data });
      if (result.count === 1 && afterChange) await afterChange(tx);
      return result;
    });
    if (updated.count === 0) {
      const exists = await this.prisma.order.count({ where: { id, ...owner } });
      throw exists ? this.invalidStatus() : this.notFound();
    }
    return this.getForParticipant(userId, id);
  }

  private async claimResult(result: ClaimResult, code: string, userId: string) {
    return { result, order: await this.getByCode(code, userId) };
  }

  private view(order: OrderWithPeople, userId?: string) {
    return toOrderView(order, viewerOf(order, userId), this.config.publicBaseUrl, new Date(), userId);
  }

  private withShareTexts(order: OrderWithPeople) {
    const links = linksOf(order, this.config.publicBaseUrl);
    const driver = order.claimedBy?.profile;
    const legs = legsOf(order);
    const liveLegs = legs?.filter((leg) => leg.status !== 'CANCELLED');
    // A 接駁 order goes out as one: one group text and one link, the first leg's, for drivers and
    // for the passenger alike.
    const head = order.journeyHead ? linksOf(order.journeyHead, this.config.publicBaseUrl) : links;
    return {
      ...toOrderView(order, 'dispatcher', this.config.publicBaseUrl, new Date(), order.dispatcherId),
      share: {
        dispatch: order.carpool
          ? carpoolShareText(order, { partyCount: order.carpool.seatsList.length, stops: carpoolStopsOf(order.carpool.seatsList) }, links.dispatch)
          : legs && legs.length > 1 && order.journeyKind === 'ROUND_TRIP'
            ? roundTripShareText(
                legs.map((leg) => ({ ...leg, selfDriven: leg.claimedById === order.dispatcherId })),
                head.dispatch,
              )
            : legs && legs.length > 1
            ? transferShareText(
                legs.map((leg) => ({ ...leg, selfDriven: leg.claimedById === order.dispatcherId })),
                head.dispatch,
              )
            : dispatchShareText(order, links.dispatch),
        claimed: driver ? claimedShareText(order, driver, liveLegs) : null,
        passenger: passengerShareText(order, head.passengerConfirm, liveLegs),
      },
    };
  }

  private notFound() {
    return apiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
  }

  private invalidStatus() {
    return apiError(HttpStatus.CONFLICT, 'INVALID_ORDER_STATUS', 'The order cannot change from its current status');
  }
}
