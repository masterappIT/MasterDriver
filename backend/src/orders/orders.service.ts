import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import {
  MAX_JOURNEY_LEGS,
  type ContactRevealUpdate,
  type CreateOrderInput,
  type OrderPaymentUpdate,
  type OrderSettlementUpdate,
  type TripGroupUpdate,
  type OrderListQuery,
  type PoolQuery,
  type PoolUpdate,
  type UpdateOrderPricesInput,
} from '@masterdriver/shared';
import { Prisma, type OrderStatus } from '../../generated/prisma';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomCode } from '../common/crypto';
import { apiError } from '../common/errors';
import { CommissionService } from '../billing/commission.service';
import { CreditsService } from '../billing/credits.service';
import { EntitlementsService, FEATURES } from '../entitlements/entitlements.service';
import { GroupInvitesService, WECHAT_GROUP_QR_DAYS } from '../groups/group-invites.service';
import { decodeQrImage } from '../groups/qr-image';
import { PaymentMethodsService } from '../payment-methods/payment-methods.service';
import { PrismaService } from '../prisma.service';
import { contactRevealAt, orderInclude, legsOf, passengerPriceOf, toOrderView, toPassengerView, viewerOf, linksOf, type OrderWithPeople } from './order-view';
import { claimedShareText, dispatchShareText, passengerShareText } from './share-text';

const ORDER_CODE_LENGTH = 10;
const CONFIRM_CODE_LENGTH = 12;
const LIST_LIMIT = 50;
/** 客人通訊錄 reads this many of the dispatcher's latest orders. */
const PASSENGER_BOOK_ORDERS = 2000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  ) {}

  async create(userId: string, input: CreateOrderInput, now = new Date()) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        // Quota, order and service fee succeed or fail together: with too few
        // credits nothing is created and no quota is used.
        const order = await this.prisma.$transaction(async (tx) => {
          const pickupAt = new Date(input.pickupAt);
          const leg = input.afterOrderId ? await this.nextLeg(tx, userId, input.afterOrderId, pickupAt, input.origin) : null;
          if (input.selfDrive) await this.requireProfile(tx, userId);
          // 接駁: a trip uses the quota and pays the service fee once, with its first leg.
          if (!leg) await this.entitlements.consume(tx, userId, FEATURES.orderCreate, now);
          const fee = leg ? 0 : await this.commission.feeFor(tx, userId, now);
          const defaults =
            input.contactRevealMinutes === undefined || input.inPool === undefined
              ? await tx.user.findUniqueOrThrow({ where: { id: userId }, select: { contactRevealMinutes: true, poolByDefault: true } })
              : null;
          const preference = input.contactRevealMinutes === undefined ? defaults!.contactRevealMinutes : input.contactRevealMinutes;
          const placed = await tx.order.create({
            data: {
              code: randomCode(ORDER_CODE_LENGTH),
              confirmCode: randomCode(CONFIRM_CODE_LENGTH),
              dispatcherId: userId,
              pickupAt,
              origin: input.origin,
              destination: input.destination,
              waypoints: input.waypoints,
              passengers: input.passengers,
              luggage: input.luggage,
              vehicleType: input.vehicleType,
              driverPriceMinor: toMinor(input.driverPrice),
              driverCurrency: input.driverPrice?.currency ?? 'HKD',
              passengerPriceMinor: toMinor(input.passengerPrice),
              passengerCurrency: input.passengerPrice?.currency ?? input.driverPrice?.currency ?? 'HKD',
              showPassengerPrice: input.showPassengerPrice,
              commissionMinor: fee > 0 ? fee : null,
              notes: input.notes,
              rawText: input.rawText,
              passengerName: input.passengerName,
              passengerContact: input.passengerContact,
              contactRevealMinutes: preference,
              requiredPlates: input.requiredPlates,
              // 這單我自己做 is never offered to others, so it stays out of the 接單池 too.
              inPool: !input.selfDrive && (input.inPool ?? defaults!.poolByDefault),
              // 收款 belongs to the whole trip: a new leg follows the trip's first leg.
              showPaymentMethods: leg ? leg.showPaymentMethods : input.showPaymentMethods,
              paidAt: leg ? leg.paidAt : null,
              ...(leg ? { journeyId: leg.journeyId, legIndex: leg.legIndex } : {}),
              // 這單我自己做: taken by the dispatcher at once, never offered for claiming.
              ...(input.selfDrive ? { status: 'ASSIGNED' as const, claimedById: userId, claimedAt: now } : {}),
            },
            include: orderInclude,
          });
          // 接駁 chosen when dispatching: the order is leg 1 of a new trip from the start.
          const created =
            !leg && input.transfer
              ? await tx.order.update({ where: { id: placed.id }, data: { journeyId: placed.id, legIndex: 1 }, include: orderInclude })
              : placed;
          if (fee > 0) await this.credits.charge(tx, userId, created.id, fee);
          if (input.bookingId) await this.takeBooking(tx, userId, input.bookingId, created.id);
          return created;
        });
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
    for (const order of orders) {
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
      where: query.role === 'dispatched' ? { dispatcherId: userId } : { claimedById: userId },
      orderBy: { pickupAt: 'desc' },
      take: LIST_LIMIT,
      include: orderInclude,
    });
    return orders.map((order) => toOrderView(order, viewerOf(order, userId), this.config.publicBaseUrl));
  }

  /**
   * 接單池: orders their dispatchers chose to list, still open and not yet due.
   * Only for signed-in drivers who have filled in their details, the same as
   * claiming. Each order is shown as on its claim page, so no passenger details.
   */
  async pool(userId: string, query: PoolQuery, now = new Date()) {
    await this.requireProfile(this.prisma, userId);
    const dayStart = query.date ? new Date(`${query.date}T00:00:00+08:00`) : null;
    const orders = await this.prisma.order.findMany({
      where: {
        inPool: true,
        status: 'OPEN',
        scope: 'PUBLIC',
        dispatcherId: { not: userId },
        pickupAt: {
          gte: dayStart && dayStart > now ? dayStart : now,
          ...(dayStart ? { lt: new Date(dayStart.getTime() + DAY_MS) } : {}),
        },
        ...(query.q
          ? { OR: [{ origin: { contains: query.q, mode: 'insensitive' } }, { destination: { contains: query.q, mode: 'insensitive' } }] }
          : {}),
      },
      orderBy: { pickupAt: 'asc' },
      take: LIST_LIMIT,
      include: orderInclude,
    });
    return orders.map((order) => toOrderView(order, 'other', this.config.publicBaseUrl, now));
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
      select: { id: true, dispatcherId: true, claimedById: true, status: true, scope: true },
    });
    if (!order) throw this.notFound();
    if (order.dispatcherId === userId) {
      throw apiError(HttpStatus.CONFLICT, 'CANNOT_CLAIM_OWN_ORDER', 'Dispatchers cannot claim their own order');
    }
    if (order.claimedById === userId) return this.claimResult('WON', code, userId);
    if (order.scope === 'TEAM') throw apiError(HttpStatus.FORBIDDEN, 'TEAM_ONLY', 'Only team members can claim this order');

    await this.requireProfile(this.prisma, userId);

    const updated = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'OPEN', claimedById: null },
      data: { status: 'ASSIGNED', claimedById: userId, claimedAt: now },
    });
    const result: ClaimResult = updated.count === 1 ? 'WON' : 'LOST';
    await this.prisma.orderClaim.create({ data: { orderId: order.id, driverId: userId, result } });
    return this.claimResult(result, code, userId);
  }

  /**
   * Cancelling returns the service fee, in the same transaction. A trip with
   * 接駁 paid once, on its first leg, so its fee returns only when the last of
   * its legs is cancelled; the other legs are never cancelled automatically.
   */
  async cancel(userId: string, id: string, now = new Date()) {
    return this.transition(userId, id, ['OPEN', 'ASSIGNED'], { status: 'CANCELLED', cancelledAt: now }, 'dispatcher', async (tx) => {
      const { journeyId } = await tx.order.findUniqueOrThrow({ where: { id }, select: { journeyId: true } });
      if (!journeyId) return this.credits.refundOrder(tx, id);
      await this.lockJourney(tx, journeyId);
      const live = await tx.order.count({ where: { journeyId, status: { not: 'CANCELLED' } } });
      if (live === 0) await this.credits.refundOrder(tx, journeyId);
    });
  }

  /** "改派": take the order back from the driver and open it for claiming again. */
  async reopen(userId: string, id: string) {
    return this.transition(
      userId,
      id,
      ['ASSIGNED'],
      { status: 'OPEN', claimedById: null, claimedAt: null, passengerConfirmedAt: null, settledAt: null },
      'dispatcher',
    );
  }

  async complete(userId: string, id: string, now = new Date()) {
    return this.transition(userId, id, ['ASSIGNED'], { status: 'COMPLETED', completedAt: now }, 'participant');
  }

  /**
   * The dispatcher changes prices or whether the passenger sees theirs. The
   * driver price is locked once a driver has claimed at that price.
   */
  async updatePrices(userId: string, id: string, input: UpdateOrderPricesInput) {
    const order = await this.prisma.order.findFirst({ where: { id, dispatcherId: userId }, select: { status: true } });
    if (!order) throw this.notFound();
    if (order.status === 'CANCELLED' || order.status === 'COMPLETED') throw this.invalidStatus();
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
    const legs = legsOf(order)?.filter((leg) => leg.status !== 'CANCELLED') ?? [order];
    const prices = legs.map(passengerPriceOf);
    const sameCurrency = prices.every((price) => price && price.currency === prices[0]?.currency);
    const amount =
      prices.length > 0 && sameCurrency
        ? { amount: Math.round(prices.reduce((sum, price) => sum + price!.amount * 100, 0)) / 100, currency: prices[0]!.currency }
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
    await this.prisma.order.updateMany({
      where: { ...trip, status: { in: ['OPEN', 'ASSIGNED'] }, passengerConfirmedAt: null },
      data: { passengerConfirmedAt: now },
    });
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
   * Where a new leg goes: after the last leg of the trip that `afterOrderId`
   * belongs to, which must be that leg. An order on its own becomes leg 1 of a
   * new trip. Runs under the trip's lock, like cancelling a leg.
   *
   * The new leg starts at the 接駁位置, where the previous leg ends: a different
   * `origin` moves the previous leg's destination there, unless another driver
   * has already claimed that leg as it was.
   */
  private async nextLeg(tx: Prisma.TransactionClient, userId: string, afterOrderId: string, pickupAt: Date, origin: string) {
    const previous = await tx.order.findFirst({ where: { id: afterOrderId, dispatcherId: userId }, select: { journeyId: true } });
    if (!previous) throw this.notFound();
    const journeyId = previous.journeyId ?? afterOrderId;
    await this.lockJourney(tx, journeyId);
    await tx.order.updateMany({ where: { id: journeyId, journeyId: null }, data: { journeyId, legIndex: 1 } });
    const legs = await tx.order.findMany({
      where: { journeyId },
      orderBy: { legIndex: 'asc' },
      select: { id: true, legIndex: true, status: true, pickupAt: true, destination: true },
    });
    const last = legs[legs.length - 1];
    if (last.id !== afterOrderId) {
      throw apiError(HttpStatus.CONFLICT, 'NOT_LAST_LEG', 'A leg can only follow the last leg of the trip');
    }
    if (last.status === 'CANCELLED') throw this.invalidStatus();
    if (legs.length >= MAX_JOURNEY_LEGS) {
      throw apiError(HttpStatus.CONFLICT, 'JOURNEY_LEG_LIMIT', `A trip has at most ${MAX_JOURNEY_LEGS} legs`);
    }
    if (pickupAt < last.pickupAt) {
      throw apiError(HttpStatus.BAD_REQUEST, 'LEG_BEFORE_PREVIOUS', 'A leg cannot start before the previous leg');
    }
    if (origin !== last.destination) {
      // The condition also closes the race with a claim landing in between.
      const moved = await tx.order.updateMany({
        where: { id: last.id, OR: [{ status: 'OPEN' }, { status: 'ASSIGNED', claimedById: userId }] },
        data: { destination: origin },
      });
      if (moved.count === 0) {
        throw apiError(HttpStatus.CONFLICT, 'TRANSFER_PLACE_LOCKED', 'The previous leg is claimed; its destination cannot change');
      }
    }
    const head = await tx.order.findUniqueOrThrow({ where: { id: journeyId }, select: { showPaymentMethods: true, paidAt: true } });
    return { journeyId, legIndex: (last.legIndex ?? 1) + 1, showPaymentMethods: head.showPaymentMethods, paidAt: head.paidAt };
  }

  /**
   * Adding and cancelling legs of one trip take turns on the first leg's row,
   * so a refund decision never misses a leg added or cancelled at the same time.
   */
  private async lockJourney(tx: Prisma.TransactionClient, journeyId: string) {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${journeyId} FOR UPDATE`;
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
    return toOrderView(order, viewerOf(order, userId), this.config.publicBaseUrl);
  }

  private withShareTexts(order: OrderWithPeople) {
    const links = linksOf(order, this.config.publicBaseUrl);
    const driver = order.claimedBy?.profile;
    const legs = legsOf(order);
    const liveLegs = legs?.filter((leg) => leg.status !== 'CANCELLED');
    // The passenger gets one link for the whole trip: the first leg's.
    const tripConfirm = order.journeyHead ? linksOf(order.journeyHead, this.config.publicBaseUrl).passengerConfirm : links.passengerConfirm;
    return {
      ...toOrderView(order, 'dispatcher', this.config.publicBaseUrl),
      share: {
        dispatch: dispatchShareText({ ...order, legCount: legs?.length }, links.dispatch),
        claimed: driver ? claimedShareText(order, driver) : null,
        passenger: passengerShareText(order, tripConfirm, liveLegs),
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
