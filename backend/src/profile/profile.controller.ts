import { Body, Controller, Get, Inject, Put, UseGuards } from '@nestjs/common';
import { contactRevealUpdateSchema, driverProfileSchema, type ContactRevealUpdate, type DriverProfileInput } from '@masterdriver/shared';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
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
    const data = {
      name: body.name,
      hkPlate: body.hkPlate ?? null,
      macauPlate: body.macauPlate ?? null,
      mainlandPlate: body.mainlandPlate ?? null,
      vehicleType: body.vehicleType ?? null,
      seats: body.seats ?? null,
      color: body.color ?? null,
    };
    return this.prisma.driverProfile.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  }
}

/** Dispatcher defaults applied to new orders. */
@Controller('me/preferences')
@UseGuards(AuthGuard)
export class PreferencesController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.prisma.user.findUniqueOrThrow({ where: { id: user.id }, select: { contactRevealMinutes: true } });
  }

  @Put()
  save(@CurrentUser() user: SessionUser, @Body(new ZodPipe(contactRevealUpdateSchema)) body: ContactRevealUpdate) {
    return this.prisma.user.update({ where: { id: user.id }, data: body, select: { contactRevealMinutes: true } });
  }
}
