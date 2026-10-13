import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import {
  createOrderSchema,
  orderListQuerySchema,
  poolQuerySchema,
  poolUpdateSchema,
  contactRevealUpdateSchema,
  orderPaymentUpdateSchema,
  orderSettlementUpdateSchema,
  tripGroupUpdateSchema,
  updateOrderPricesSchema,
  type ContactRevealUpdate,
  type OrderPaymentUpdate,
  type OrderSettlementUpdate,
  type TripGroupUpdate,
  type CreateOrderInput,
  type OrderListQuery,
  type PoolQuery,
  type PoolUpdate,
  type UpdateOrderPricesInput,
} from '@masterdriver/shared';
import type { Response } from 'express';
import { AuthGuard, CurrentUser, OptionalAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { OrdersService } from './orders.service';

function sendGroupQr(response: Response, image: { mime: string; bytes: Buffer } | null) {
  if (!image) throw apiError(HttpStatus.NOT_FOUND, 'TRIP_GROUP_NOT_FOUND', 'QR not available');
  response
    .set({
      'content-type': image.mime,
      // The way into one trip's group: never kept by anything shared between people.
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    })
    .send(image.bytes);
}

/** Orders as seen by the signed-in dispatcher or driver. */
@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Post()
  create(@CurrentUser() user: SessionUser, @Body(new ZodPipe(createOrderSchema)) body: CreateOrderInput) {
    return this.orders.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: SessionUser, @Query(new ZodPipe(orderListQuerySchema)) query: OrderListQuery) {
    return this.orders.list(user.id, query);
  }

  /** 客人通訊錄: the passengers of the orders this user put out. Declared before `:id`. */
  @Get('passengers')
  passengers(@CurrentUser() user: SessionUser) {
    return this.orders.passengers(user.id);
  }

  /** 接單池. Declared before `:id` so "pool" is not read as an order id. */
  @Get('pool')
  pool(@CurrentUser() user: SessionUser, @Query(new ZodPipe(poolQuerySchema)) query: PoolQuery) {
    return this.orders.pool(user.id, query);
  }

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.getForParticipant(user.id, id);
  }

  @Patch(':id/prices')
  updatePrices(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodPipe(updateOrderPricesSchema)) body: UpdateOrderPricesInput,
  ) {
    return this.orders.updatePrices(user.id, id, body);
  }

  @Patch(':id/contact-reveal')
  setContactReveal(
    @CurrentUser() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodPipe(contactRevealUpdateSchema)) body: ContactRevealUpdate,
  ) {
    return this.orders.setContactReveal(user.id, id, body);
  }

  /** 收款: show the dispatcher's ways to be paid to the passenger, and mark the fare received. */
  @Patch(':id/payment')
  setPayment(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(orderPaymentUpdateSchema)) body: OrderPaymentUpdate) {
    return this.orders.setPayment(user.id, id, body);
  }

  /** 行程群: the dispatcher's own group for the trip, given to the passenger and the driver. */
  @Patch(':id/trip-group')
  setTripGroup(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(tripGroupUpdateSchema)) body: TripGroupUpdate) {
    return this.orders.setTripGroup(user.id, id, body);
  }

  @Get(':id/trip-group/qr')
  async tripGroupQr(@CurrentUser() user: SessionUser, @Param('id') id: string, @Res() response: Response) {
    sendGroupQr(response, await this.orders.tripGroupQr({ userId: user.id, id }));
  }

  /** 已結清: the dispatcher's mark that the account with the driver of a finished order is settled. */
  @Patch(':id/settlement')
  setSettlement(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(orderSettlementUpdateSchema)) body: OrderSettlementUpdate) {
    return this.orders.setSettlement(user.id, id, body);
  }

  @Patch(':id/pool')
  setPool(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(poolUpdateSchema)) body: PoolUpdate) {
    return this.orders.setPool(user.id, id, body);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.cancel(user.id, id);
  }

  @Post(':id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.reopen(user.id, id);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.orders.complete(user.id, id);
  }
}

/** The dispatch link a driver opens from a group: /o/{code}. */
@Controller('o')
export class DispatchLinkController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get(':code')
  @UseGuards(OptionalAuthGuard)
  view(@Param('code') code: string, @CurrentUser() user?: SessionUser) {
    return this.orders.getByCode(code, user?.id);
  }

  @Post(':code/claim')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  claim(@Param('code') code: string, @CurrentUser() user: SessionUser) {
    return this.orders.claim(code, user.id);
  }
}

/** The confirmation link the dispatcher sends the passenger: /c/{confirmCode}. No sign-in. */
@Controller('c')
export class PassengerLinkController {
  constructor(@Inject(OrdersService) private readonly orders: OrdersService) {}

  @Get(':confirmCode')
  view(@Param('confirmCode') confirmCode: string) {
    return this.orders.getForPassenger(confirmCode);
  }

  @Get(':confirmCode/trip-group/qr')
  async tripGroupQr(@Param('confirmCode') confirmCode: string, @Res() response: Response) {
    sendGroupQr(response, await this.orders.tripGroupQr({ confirmCode }));
  }

  @Post(':confirmCode/confirm')
  @HttpCode(200)
  confirm(@Param('confirmCode') confirmCode: string) {
    return this.orders.confirmByPassenger(confirmCode);
  }
}
