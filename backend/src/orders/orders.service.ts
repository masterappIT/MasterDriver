import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { CreateOrderInput, OrderListQuery, UpdateOrderPricesInput } from '@masterdriver/shared';
import { Prisma, type OrderStatus } from '../../generated/prisma';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomCode } from '../common/crypto';
import { apiError } from '../common/errors';
import { EntitlementsService, FEATURES } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma.service';
import { orderInclude, toOrderView, toPassengerView, viewerOf, linksOf, type OrderWithPeople } from './order-view';
import { claimedShareText, dispatchShareText, passengerShareText } from './share-text';

const ORDER_CODE_LENGTH = 10;
const CONFIRM_CODE_LENGTH = 12;
const LIST_LIMIT = 50;

export type ClaimResult = 'WON' | 'LOST';

type Money = { amount: number; currency: 'HKD' | 'CNY' | 'MOP' } | null | undefined;
const toMinor = (price: Money) => (price ? Math.round(price.amount * 100) : null);

@Injectable()
export class OrdersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(userId: string, input: CreateOrderInput, now = new Date()) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        const order = await this.prisma.$transaction(async (tx) => {
          await this.entitlements.consume(tx, userId, FEATURES.orderCreate, now);
          return tx.order.create({
            data: {
              code: randomCode(ORDER_CODE_LENGTH),
              confirmCode: randomCode(CONFIRM_CODE_LENGTH),
              dispatcherId: userId,
              pickupAt: new Date(input.pickupAt),
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
              notes: input.notes,
              passengerName: input.passengerName,
              passengerContact: input.passengerContact,
            },
            include: orderInclude,
          });
        });
        return this.withShareTexts(order);
      } catch (error) {
        // A random code collided with an existing one: try again with new codes.
        const collided = error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
        if (!collided || attempt >= 2) throw error;
      }
    }
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
    return this.view(order, userId);
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

    const profile = await this.prisma.driverProfile.findUnique({ where: { userId }, select: { userId: true } });
    if (!profile) throw apiError(HttpStatus.CONFLICT, 'PROFILE_REQUIRED', 'Fill in your driver details first');

    const updated = await this.prisma.order.updateMany({
      where: { id: order.id, status: 'OPEN', claimedById: null },
      data: { status: 'ASSIGNED', claimedById: userId, claimedAt: now },
    });
    const result: ClaimResult = updated.count === 1 ? 'WON' : 'LOST';
    await this.prisma.orderClaim.create({ data: { orderId: order.id, driverId: userId, result } });
    return this.claimResult(result, code, userId);
  }

  async cancel(userId: string, id: string, now = new Date()) {
    return this.transition(userId, id, ['OPEN', 'ASSIGNED'], { status: 'CANCELLED', cancelledAt: now }, 'dispatcher');
  }

  /** "改派": take the order back from the driver and open it for claiming again. */
  async reopen(userId: string, id: string) {
    return this.transition(
      userId,
      id,
      ['ASSIGNED'],
      { status: 'OPEN', claimedById: null, claimedAt: null, passengerConfirmedAt: null },
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

  async getForPassenger(confirmCode: string) {
    const order = await this.prisma.order.findUnique({ where: { confirmCode }, include: orderInclude });
    if (!order) throw this.notFound();
    return toPassengerView(order);
  }

  async confirmByPassenger(confirmCode: string, now = new Date()) {
    const order = await this.prisma.order.findUnique({ where: { confirmCode }, select: { status: true } });
    if (!order) throw this.notFound();
    if (order.status === 'CANCELLED') throw this.invalidStatus();
    await this.prisma.order.updateMany({
      where: { confirmCode, status: { in: ['OPEN', 'ASSIGNED'] }, passengerConfirmedAt: null },
      data: { passengerConfirmedAt: now },
    });
    return this.getForPassenger(confirmCode);
  }

  private async transition(
    userId: string,
    id: string,
    from: OrderStatus[],
    data: Prisma.OrderUncheckedUpdateManyInput,
    who: 'dispatcher' | 'participant',
  ) {
    const owner: Prisma.OrderWhereInput =
      who === 'dispatcher' ? { dispatcherId: userId } : { OR: [{ dispatcherId: userId }, { claimedById: userId }] };
    const updated = await this.prisma.order.updateMany({ where: { id, status: { in: from }, ...owner }, data });
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
    return {
      ...toOrderView(order, 'dispatcher', this.config.publicBaseUrl),
      share: {
        dispatch: dispatchShareText(order, links.dispatch),
        claimed: driver ? claimedShareText(order, driver) : null,
        passenger: passengerShareText(order, links.passengerConfirm),
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
