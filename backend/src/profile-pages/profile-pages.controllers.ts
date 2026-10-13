import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Req, Res, UseGuards } from '@nestjs/common';
import {
  PROFILE_PHOTO_MAX_BYTES,
  bookingCreateSchema,
  bookingQuoteSchema,
  profilePageUpdateSchema,
  type BookingCreate,
  type BookingQuote,
  type ProfilePageUpdate,
} from '@masterdriver/shared';
import type { Request, Response } from 'express';
import { AuthGuard, CurrentUser, OptionalAuthGuard } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { readLimited } from '../support/read-body';
import { ProfilePagesService } from './profile-pages.service';

/** The driver's own page and the booking requests sent to it. */
@Controller('me')
@UseGuards(AuthGuard)
export class MyProfilePageController {
  constructor(@Inject(ProfilePagesService) private readonly pages: ProfilePagesService) {}

  @Get('profile-page')
  page(@CurrentUser() user: SessionUser) {
    return this.pages.mine(user.id);
  }

  @Put('profile-page')
  update(@CurrentUser() user: SessionUser, @Body(new ZodPipe(profilePageUpdateSchema)) body: ProfilePageUpdate) {
    return this.pages.update(user.id, body);
  }

  /** The request body is the picture itself. */
  @Post('profile-page/photos')
  async addPhoto(@CurrentUser() user: SessionUser, @Req() request: Request) {
    const bytes = await readLimited(request, PROFILE_PHOTO_MAX_BYTES);
    if (!bytes) throw apiError(HttpStatus.PAYLOAD_TOO_LARGE, 'PHOTO_TOO_LARGE', 'The picture is too large');
    return this.pages.addPhoto(user.id, bytes);
  }

  @Delete('profile-page/photos/:id')
  removePhoto(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.pages.removePhoto(user.id, id);
  }

  @Get('bookings')
  bookings(@CurrentUser() user: SessionUser) {
    return this.pages.bookings(user.id);
  }

  @Get('bookings/unread')
  unread(@CurrentUser() user: SessionUser) {
    return this.pages.unread(user.id);
  }

  @Get('bookings/:id')
  booking(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.pages.booking(user.id, id);
  }

  @Post('bookings/:id/quote')
  @HttpCode(200)
  quote(@CurrentUser() user: SessionUser, @Param('id') id: string, @Body(new ZodPipe(bookingQuoteSchema)) body: BookingQuote) {
    return this.pages.quote(user.id, id, body);
  }

  @Post('bookings/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: SessionUser, @Param('id') id: string) {
    return this.pages.decline(user.id, id);
  }
}

/** What a passenger reaches without an account: the page, and their own booking request. */
@Controller('public')
@UseGuards(OptionalAuthGuard)
export class PublicProfilePageController {
  constructor(@Inject(ProfilePagesService) private readonly pages: ProfilePagesService) {}

  @Get('profiles/:code')
  page(@Param('code') code: string, @CurrentUser() user: SessionUser | undefined) {
    return this.pages.publicPage(code, user?.id);
  }

  @Get('profiles/:code/photos/:id')
  async photo(@Param('code') code: string, @Param('id') id: string, @CurrentUser() user: SessionUser | undefined, @Res() response: Response) {
    const photo = await this.pages.photo(code, id, user?.id);
    response
      .set({
        'content-type': photo.mime,
        // A photo never changes under its id; a removed one stops being served once this runs out.
        'cache-control': 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      })
      .send(photo.bytes);
  }

  @Post('profiles/:code/bookings')
  createBooking(@Param('code') code: string, @Body(new ZodPipe(bookingCreateSchema)) body: BookingCreate, @Req() request: Request) {
    return this.pages.createBooking(code, body, request.ip);
  }

  @Get('bookings/:code')
  booking(@Param('code') code: string) {
    return this.pages.passengerBooking(code);
  }

  @Post('bookings/:code/accept')
  @HttpCode(200)
  accept(@Param('code') code: string) {
    return this.pages.passengerAccept(code);
  }

  @Post('bookings/:code/cancel')
  @HttpCode(200)
  cancel(@Param('code') code: string) {
    return this.pages.passengerCancel(code);
  }
}

/** The driver's vehicle photos on a passenger's confirmation link: /c/{confirmCode}. No sign-in. */
@Controller('c')
export class PassengerDriverPhotoController {
  constructor(@Inject(ProfilePagesService) private readonly pages: ProfilePagesService) {}

  @Get(':confirmCode/driver-photos/:id')
  async photo(@Param('confirmCode') confirmCode: string, @Param('id') id: string, @Res() response: Response) {
    const photo = await this.pages.passengerPhoto(confirmCode, id);
    response
      .set({
        'content-type': photo.mime,
        // Behind an unguessable link, for one passenger: not for shared caches.
        'cache-control': 'private, max-age=3600',
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      })
      .send(photo.bytes);
  }
}
