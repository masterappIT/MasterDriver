import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { smsChannelUpdateSchema, type SmsChannelUpdate } from '@masterdriver/shared';
import type { Request } from 'express';
import { z } from 'zod';
import type { AdminUser } from '../admin/admin-auth.service';
import { AdminGuard, AdminRoles, CurrentAdmin } from '../admin/admin.guard';
import { AuditService } from '../admin/audit.service';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { environmentOf, PaymentChannelsService } from './payment-channels.service';
import { routeOf, SmsChannelsService } from './sms-channels.service';

const testSendSchema = z.object({ phone: z.string().trim().max(20).optional() });

/**
 * Like Master Travel: super admins and operators can see the channels; only
 * super admins can change them, run checks or send a test SMS. The audit log
 * records which fields changed, never their values.
 */
@Controller('admin')
@UseGuards(AdminGuard)
export class ChannelsController {
  constructor(
    @Inject(PaymentChannelsService) private readonly payments: PaymentChannelsService,
    @Inject(SmsChannelsService) private readonly sms: SmsChannelsService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private log(admin: AdminUser, action: string, request: Request, targetId: string, fields: string[] = []) {
    return this.audit.log({ adminId: admin.id, action, targetId, detail: { fields }, ip: request.ip });
  }

  // ---- 付款通道

  @Get('payment-channels')
  @AdminRoles('SUPER_ADMIN', 'OPERATOR')
  paymentChannels() {
    return this.payments.list();
  }

  @Put('payment-channels/stripe/:environment')
  @AdminRoles('SUPER_ADMIN')
  async saveStripe(@Param('environment') environment: string, @Body() body: Record<string, unknown>, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.payments.saveStripe(environmentOf(environment), body, `admin:${admin.username}`);
    await this.log(admin, 'channels.stripe.save', request, environment, Object.keys(body).filter((key) => body[key] !== ''));
    return result;
  }

  @Post('payment-channels/stripe/:environment/test')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  async testStripe(@Param('environment') environment: string, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.payments.testStripe(environmentOf(environment));
    await this.log(admin, 'channels.stripe.test', request, environment);
    return result;
  }

  @Put('payment-channels/alipay-hk/:environment')
  @AdminRoles('SUPER_ADMIN')
  async saveAlipayHk(@Param('environment') environment: string, @Body() body: Record<string, unknown>, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.payments.saveAlipayHk(environmentOf(environment), body, `admin:${admin.username}`);
    await this.log(admin, 'channels.alipayhk.save', request, environment, Object.keys(body).filter((key) => body[key] !== ''));
    return result;
  }

  @Post('payment-channels/alipay-hk/:environment/test')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  async testAlipayHk(@Param('environment') environment: string, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.payments.testAlipayHk(environmentOf(environment));
    await this.log(admin, 'channels.alipayhk.test', request, environment);
    return result;
  }

  @Post('payment-channels/:provider/:environment/:action')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  async setEnabled(
    @Param('provider') provider: string,
    @Param('environment') environment: string,
    @Param('action') action: string,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    const key = provider === 'stripe' ? 'STRIPE' : provider === 'alipay-hk' ? 'ALIPAY_HK' : null;
    if (!key || (action !== 'enable' && action !== 'disable')) throw apiError(HttpStatus.NOT_FOUND, 'CHANNEL_NOT_FOUND', 'Unknown channel action');
    const result = await this.payments.setEnabled(key, environmentOf(environment), action === 'enable', `admin:${admin.username}`);
    await this.log(admin, `channels.payment.${action}`, request, `${key}:${environment}`);
    return result;
  }

  // ---- 簡訊通道

  @Get('sms-channels')
  @AdminRoles('SUPER_ADMIN', 'OPERATOR')
  smsChannels() {
    return this.sms.list();
  }

  @Get('sms-messages')
  @AdminRoles('SUPER_ADMIN', 'OPERATOR')
  smsMessages() {
    return this.sms.messages();
  }

  @Put('sms-channels/:route')
  @AdminRoles('SUPER_ADMIN')
  async saveSms(@Param('route') route: string, @Body(new ZodPipe(smsChannelUpdateSchema)) body: SmsChannelUpdate, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.sms.save(routeOf(route), body, `admin:${admin.username}`);
    await this.log(admin, 'channels.sms.save', request, route, Object.keys(body).filter((key) => body[key as keyof SmsChannelUpdate] !== ''));
    return result;
  }

  @Post('sms-channels/:route/test-connection')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  async testSms(@Param('route') route: string, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.sms.testConnection(routeOf(route));
    await this.log(admin, 'channels.sms.test', request, route);
    return result;
  }

  @Post('sms-channels/:route/test-send')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  async testSend(@Param('route') route: string, @Body(new ZodPipe(testSendSchema)) body: z.infer<typeof testSendSchema>, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.sms.testSend(routeOf(route), body.phone);
    await this.log(admin, 'channels.sms.testSend', request, route);
    return result;
  }
}
