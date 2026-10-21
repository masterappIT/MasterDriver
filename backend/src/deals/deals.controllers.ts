import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  dealBookingCreateSchema,
  dealCreateSchema,
  dealUpdateSchema,
  type DealBookingCreate,
  type DealCreate,
  type DealUpdate,
} from '@masterdriver/shared';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { ZodPipe } from '../common/zod-pipe';
import { DealsService } from './deals.service';

/** 特價車 the signed-in driver put up. Their bookings are answered under /me/bookings. */
@Controller('deals')
@UseGuards(AuthGuard)
export class DealsController {
  constructor(@Inject(DealsService) private readonly deals: DealsService) {}

  @Post()
  create(@CurrentUser() user: SessionUser, @Body(new ZodPipe(dealCreateSchema)) body: DealCreate) {
    return this.deals.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.deals.list(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.deals.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(dealUpdateSchema)) body: DealUpdate) {
    return this.deals.update(user.id, id, body);
  }

  /** 關閉: no new bookings; the ones sent are still answered. */
  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.deals.close(user.id, id);
  }
}

/** What a passenger reaches without an account: the deal link; their booking is under /public/bookings. */
@Controller('public/deals')
export class PublicDealsController {
  constructor(@Inject(DealsService) private readonly deals: DealsService) {}

  @Get(':code')
  deal(@Param('code') code: string) {
    return this.deals.publicDeal(code);
  }

  @Get(':code/photos/:id')
  async photo(@Param('code') code: string, @Param('id') id: string, @Res() response: Response) {
    const photo = await this.deals.photo(code, id);
    response
      .set({
        'content-type': photo.mime,
        // Behind an unguessable link: not for shared caches.
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      })
      .send(photo.bytes);
  }

  @Post(':code/bookings')
  book(@Param('code') code: string, @Body(new ZodPipe(dealBookingCreateSchema)) body: DealBookingCreate, @Req() request: Request) {
    return this.deals.createBooking(code, body, request.ip);
  }
}
