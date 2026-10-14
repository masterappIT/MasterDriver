import { Body, Controller, Get, HttpStatus, Inject, Put, UseGuards } from '@nestjs/common';
import { driverProfileSchema, preferencesUpdateSchema, type DriverProfileInput, type PreferencesUpdate } from '@masterdriver/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { PrismaService } from '../prisma.service';

/** The driver details asked for once, the first time a driver claims an order. */
@Controller('me/profile')
@UseGuards(AuthGuard)
export class ProfileController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  async get(@CurrentUser() user: SessionUser) {
    return (await this.prisma.driverProfile.findUnique({ where: { userId: user.id } })) ?? null;
  }

  @Put()
  save(@CurrentUser() user: SessionUser, @Body(new ZodPipe(driverProfileSchema)) body: DriverProfileInput) {
    // A cross-border driver is reached on both sides. One of the two numbers is always the one
    // they sign in with, whatever was sent for that side; the driver gives the other.
    // Asked for when the driver saves their own details; details saved before this stay as they are.
    const signIn = `${user.countryCode} ${user.phone}`;
    const hkMacauPhone = user.countryCode === '+86' ? body.hkMacauPhone : signIn;
    const mainlandPhone = user.countryCode === '+86' ? signIn : body.mainlandPhone;
    if (!hkMacauPhone) throw apiError(HttpStatus.BAD_REQUEST, 'HK_MACAU_PHONE_REQUIRED', 'A Hong Kong or Macau number is required');
    if (!mainlandPhone) throw apiError(HttpStatus.BAD_REQUEST, 'MAINLAND_PHONE_REQUIRED', 'A mainland number is required');
    const data = {
      name: body.name,
      vehicleOwnership: body.vehicleOwnership,
      plateType: body.plateType,
      hkPlate: body.hkPlate || null,
      macauPlate: body.macauPlate || null,
      mainlandPlate: body.mainlandPlate || null,
      vehicleType: body.vehicleType,
      seats: body.seats ?? null,
      color: body.color ?? null,
      hkMacauPhone,
      mainlandPhone,
      hidePlates: body.hidePlates,
    };
    return this.prisma.driverProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  }
}

const preferenceSelect = { contactRevealMinutes: true, poolByDefault: true } as const;

/** Dispatcher defaults applied to new orders. */
@Controller('me/preferences')
@UseGuards(AuthGuard)
export class PreferencesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: preferenceSelect });
  }

  @Put()
  save(@CurrentUser() user: SessionUser, @Body(new ZodPipe(preferencesUpdateSchema)) body: PreferencesUpdate) {
    return this.prisma.user.update({ where: { id: user.id }, data: body, select: preferenceSelect });
  }
}
