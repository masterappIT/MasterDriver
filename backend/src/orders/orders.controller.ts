import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  createOrderSchema,
  orderListQuerySchema,
  updateOrderPricesSchema,
  type CreateOrderInput,
  type OrderListQuery,
  type UpdateOrderPricesInput,
} from '@masterdriver/shared';
import { AuthGuard, CurrentUser, OptionalAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { ZodPipe } from '../common/zod-pipe';
import { OrdersService } from './orders.service';

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

  @Post(':confirmCode/confirm')
  @HttpCode(200)
  confirm(@Param('confirmCode') confirmCode: string) {
    return this.orders.confirmByPassenger(confirmCode);
  }
}
