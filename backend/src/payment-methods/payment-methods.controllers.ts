import { Body, Controller, Delete, Get, HttpStatus, Inject, Param, Patch, Post, Res, UseGuards } from '@nestjs/common';
import {
  paymentMethodCreateSchema,
  paymentMethodUpdateSchema,
  type PaymentMethodCreate,
  type PaymentMethodUpdate,
} from '@masterdriver/shared';
import type { Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { PaymentMethodsService } from './payment-methods.service';

export function sendQr(response: Response, image: { mime: string; bytes: Buffer } | null) {
  if (!image) throw apiError(HttpStatus.NOT_FOUND, 'PAYMENT_METHOD_NOT_FOUND', 'QR not available');
  response
    .set({
      'content-type': image.mime,
      // A personal payment code: never kept by anything shared between people.
      'cache-control': 'private, max-age=300',
      'x-content-type-options': 'nosniff',
    })
    .send(image.bytes);
}

/** The dispatcher's own 收款方式, set in 我的. */
@Controller('me/payment-methods')
@UseGuards(AuthGuard)
export class MyPaymentMethodsController {
  constructor(@Inject(PaymentMethodsService) private readonly methods: PaymentMethodsService) {}

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.methods.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: SessionUser, @Body(new ZodPipe(paymentMethodCreateSchema)) body: PaymentMethodCreate) {
    return this.methods.create(user.id, body);
  }

  @Patch(':id')
  update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(paymentMethodUpdateSchema)) body: PaymentMethodUpdate) {
    return this.methods.update(user.id, id, body);
  }

  @Delete(':id')
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.methods.remove(user.id, id);
  }

  @Get(':id/qr')
  async qr(@CurrentUser() user: SessionUser, @Param('id') id: string, @Res() response: Response) {
    sendQr(response, await this.methods.ownQr(user.id, id));
  }
}

/** A payment QR seen by the passenger, only through the order's confirmation link. */
@Controller('c')
export class PassengerPaymentMethodsController {
  constructor(@Inject(PaymentMethodsService) private readonly methods: PaymentMethodsService) {}

  @Get(':confirmCode/payment-methods/:id/qr')
  async qr(@Param('confirmCode') confirmCode: string, @Param('id') id: string, @Res() response: Response) {
    sendQr(response, await this.methods.passengerQr(confirmCode, id));
  }
}
