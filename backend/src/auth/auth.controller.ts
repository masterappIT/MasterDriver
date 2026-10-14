import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { otpRequestSchema, otpVerifySchema, type OtpRequest, type OtpVerify } from '@masterdriver/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { ZodPipe } from '../common/zod-pipe';
import { PrismaService } from '../prisma.service';
import { AuthGuard, CurrentUser, SESSION_COOKIE } from './auth.guard';
import { AuthService, SESSION_TTL_MS, type SessionUser } from './auth.service';

@Controller()
export class AuthController {
  constructor(
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('auth/otp/request')
  @HttpCode(200)
  requestCode(@Body(new ZodPipe(otpRequestSchema)) body: OtpRequest, @Req() request: Request) {
    return this.auth.requestCode(body, request.ip);
  }

  @Get('auth/otp/areas')
  signInAreas() {
    return this.auth.signInAreas();
  }

  @Post('auth/otp/verify')
  @HttpCode(200)
  async verifyCode(
    @Body(new ZodPipe(otpVerifySchema)) body: OtpVerify,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.verifyCode(body, request.headers['user-agent']);
    response.cookie(SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.config.sessionCookieSecure,
      maxAge: SESSION_TTL_MS,
      path: '/',
    });
    return result;
  }

  @Post('auth/logout')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async logout(@CurrentUser() user: SessionUser, @Res({ passthrough: true }) response: Response) {
    await this.auth.revokeSession(user.sessionId);
    response.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  async me(@CurrentUser() user: SessionUser) {
    const profile = await this.prisma.driverProfile.findUnique({ where: { userId: user.id } });
    return {
      user: { id: user.id, countryCode: user.countryCode, phone: user.phone, locale: user.locale },
      profile,
    };
  }
}
