import { Body, Controller, Get, HttpCode, Inject, Param, Patch, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  carpoolCreateSchema,
  carpoolSeatCreateSchema,
  carpoolStartSchema,
  carpoolUpdateSchema,
  type CarpoolCreate,
  type CarpoolSeatCreate,
  type CarpoolStart,
  type CarpoolUpdate,
} from '@masterdriver/shared';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { ZodPipe } from '../common/zod-pipe';
import { sendQr } from '../payment-methods/payment-methods.controllers';
import { CarpoolsService } from './carpools.service';

function sendPhoto(response: Response, photo: { mime: string; bytes: Buffer }) {
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

/** 拼車 the signed-in driver opened, and the seats asked for on them. */
@Controller('carpools')
@UseGuards(AuthGuard)
export class CarpoolsController {
  constructor(@Inject(CarpoolsService) private readonly carpools: CarpoolsService) {}

  @Post()
  create(@CurrentUser() user: SessionUser, @Body(new ZodPipe(carpoolCreateSchema)) body: CarpoolCreate) {
    return this.carpools.create(user.id, body);
  }

  @Get()
  list(@CurrentUser() user: SessionUser) {
    return this.carpools.list(user.id);
  }

  @Get('unread')
  unread(@CurrentUser() user: SessionUser) {
    return this.carpools.unread(user.id);
  }

  @Get(':id')
  get(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.carpools.get(user.id, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(carpoolUpdateSchema)) body: CarpoolUpdate) {
    return this.carpools.update(user.id, id, body);
  }

  @Post(':id/close')
  @HttpCode(200)
  close(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.carpools.close(user.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.carpools.cancel(user.id, id);
  }

  @Post(':id/start')
  @HttpCode(200)
  start(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(carpoolStartSchema)) body: CarpoolStart) {
    return this.carpools.start(user.id, id, body);
  }

  @Post(':id/seats/:seatId/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('seatId') seatId: string) {
    return this.carpools.confirmSeat(user.id, id, seatId);
  }

  @Post(':id/seats/:seatId/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('seatId') seatId: string) {
    return this.carpools.declineSeat(user.id, id, seatId);
  }

  @Post(':id/seats/:seatId/remove')
  @HttpCode(200)
  remove(@CurrentUser() user: SessionUser, @Param('id') id: string, @Param('seatId') seatId: string) {
    return this.carpools.removeSeat(user.id, id, seatId);
  }
}

/** What a passenger reaches without an account: the carpool link, and their own seats. */
@Controller('public')
export class PublicCarpoolsController {
  constructor(@Inject(CarpoolsService) private readonly carpools: CarpoolsService) {}

  @Get('carpools/:code')
  carpool(@Param('code') code: string) {
    return this.carpools.publicCarpool(code);
  }

  @Get('carpools/:code/photos/:id')
  async photo(@Param('code') code: string, @Param('id') id: string, @Res() response: Response) {
    sendPhoto(response, await this.carpools.carpoolPhoto(code, id));
  }

  @Post('carpools/:code/seats')
  createSeat(@Param('code') code: string, @Body(new ZodPipe(carpoolSeatCreateSchema)) body: CarpoolSeatCreate, @Req() request: Request) {
    return this.carpools.createSeat(code, body, request.ip);
  }

  @Get('carpool-seats/:code')
  seat(@Param('code') code: string) {
    return this.carpools.passengerSeat(code);
  }

  @Post('carpool-seats/:code/cancel')
  @HttpCode(200)
  cancel(@Param('code') code: string) {
    return this.carpools.passengerCancel(code);
  }

  @Post('carpool-seats/:code/reconfirm')
  @HttpCode(200)
  reconfirm(@Param('code') code: string) {
    return this.carpools.passengerReconfirm(code);
  }
}

/** The driver's car photo and the payment QR codes on a party's own link: /s/{code}. No sign-in. */
@Controller('s')
export class PassengerSeatMediaController {
  constructor(@Inject(CarpoolsService) private readonly carpools: CarpoolsService) {}

  @Get(':code/driver-photos/:id')
  async photo(@Param('code') code: string, @Param('id') id: string, @Res() response: Response) {
    sendPhoto(response, await this.carpools.seatPhoto(code, id));
  }

  @Get(':code/payment-methods/:id/qr')
  async qr(@Param('code') code: string, @Param('id') id: string, @Res() response: Response) {
    sendQr(response, await this.carpools.seatQr(code, id));
  }
}
