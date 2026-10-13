import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  adminAuditQuerySchema,
  adminCreateSchema,
  adminCreditChangeSchema,
  adminReasonSchema,
  driverProfileSchema,
  adminLoginSchema,
  adminOrderQuerySchema,
  adminOverrideCreateSchema,
  adminPasswordChangeSchema,
  adminPlanFeatureSchema,
  adminPolicyCreateSchema,
  adminPolicyUpdateSchema,
  commissionUpdateSchema,
  developmentLoginUpdateSchema,
  pageQuerySchema,
  type AdminAuditQuery,
  type AdminCreate,
  type AdminCreditChange,
  type AdminReason,
  type DriverProfileInput,
  type AdminLogin,
  type AdminOrderQuery,
  type AdminOverrideCreate,
  type AdminPasswordChange,
  type AdminPlanFeature,
  type AdminPolicyCreate,
  type AdminPolicyUpdate,
  type CommissionUpdate,
  type DevelopmentLoginUpdate,
  type PageQuery,
} from '@masterdriver/shared';
import type { Request, Response } from 'express';
import { DevelopmentLoginService } from '../auth/development-login.service';
import { CommissionService } from '../billing/commission.service';
import { APP_CONFIG, type AppConfig } from '../config';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { ADMIN_SESSION_TTL_MS, AdminAuthService, type AdminUser } from './admin-auth.service';
import { AdminDataService } from './admin-data.service';
import { ADMIN_COOKIE, ADMIN_CSRF_HEADER, AdminGuard, AdminRoles, CurrentAdmin } from './admin.guard';
import { AuditService } from './audit.service';

const WRITE_ROLES = ['SUPER_ADMIN', 'OPERATOR'] as const;

/** A user's picture shown to staff: never cached by anything shared, never run as a page. */
function sendPrivateImage(response: Response, image: { mime: string; bytes: Buffer }) {
  response
    .set({
      'content-type': image.mime,
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
    })
    .send(image.bytes);
}

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodPipe(adminLoginSchema)) body: AdminLogin,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (request.headers[ADMIN_CSRF_HEADER] !== '1') {
      throw apiError(HttpStatus.FORBIDDEN, 'ADMIN_HEADER_REQUIRED', 'Admin requests must come from the admin app');
    }
    const { token, admin } = await this.auth.login(body, request.ip, request.headers['user-agent']);
    response.cookie(ADMIN_COOKIE, token, {
      httpOnly: true,
      sameSite: 'strict',
      secure: this.config.sessionCookieSecure,
      maxAge: ADMIN_SESSION_TTL_MS,
      path: '/api/admin',
    });
    return { admin };
  }

  @Post('logout')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async logout(@CurrentAdmin() admin: AdminUser, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(admin);
    response.clearCookie(ADMIN_COOKIE, { path: '/api/admin' });
    return { ok: true };
  }

  @Get('me')
  @UseGuards(AdminGuard)
  me(@CurrentAdmin() admin: AdminUser) {
    const { sessionId: _, ...rest } = admin;
    return { admin: rest };
  }

  @Post('password')
  @HttpCode(200)
  @UseGuards(AdminGuard)
  async changePassword(@CurrentAdmin() admin: AdminUser, @Body(new ZodPipe(adminPasswordChangeSchema)) body: AdminPasswordChange) {
    await this.auth.changeOwnPassword(admin, body);
    return { ok: true };
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    @Inject(AdminDataService) private readonly data: AdminDataService,
    @Inject(CommissionService) private readonly commission: CommissionService,
    @Inject(DevelopmentLoginService) private readonly developmentLogin: DevelopmentLoginService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('dashboard')
  dashboard() {
    return this.data.dashboard();
  }

  // ---- users

  @Get('users')
  users(@Query(new ZodPipe(pageQuerySchema)) query: PageQuery) {
    return this.data.listUsers(query);
  }

  @Get('users/:id')
  user(@Param('id') id: string) {
    return this.data.getUser(id);
  }

  @Post('users/:id/credits')
  @HttpCode(200)
  @AdminRoles(...WRITE_ROLES)
  changeCredits(
    @Param('id') id: string,
    @Body(new ZodPipe(adminCreditChangeSchema)) body: AdminCreditChange,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.changeCredits(id, body, admin, request.ip);
  }

  @Post('users/:id/overrides')
  @AdminRoles(...WRITE_ROLES)
  createOverride(
    @Param('id') id: string,
    @Body(new ZodPipe(adminOverrideCreateSchema)) body: AdminOverrideCreate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.createOverride(id, body, admin, request.ip);
  }

  @Delete('users/:id/overrides/:overrideId')
  @AdminRoles(...WRITE_ROLES)
  endOverride(
    @Param('id') id: string,
    @Param('overrideId') overrideId: string,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.endOverride(id, overrideId, admin, request.ip);
  }

  @Post('users/:id/suspend')
  @HttpCode(200)
  @AdminRoles(...WRITE_ROLES)
  suspendUser(@Param('id') id: string, @Body(new ZodPipe(adminReasonSchema)) body: AdminReason, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    return this.data.suspendUser(id, body, admin, request.ip);
  }

  @Post('users/:id/restore')
  @HttpCode(200)
  @AdminRoles(...WRITE_ROLES)
  restoreUser(@Param('id') id: string, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    return this.data.restoreUser(id, admin, request.ip);
  }

  // ---- complaints about a user's 名片頁 and 派單群

  @Post('users/:id/page/block')
  @HttpCode(200)
  @AdminRoles(...WRITE_ROLES)
  blockPage(@Param('id') id: string, @Body(new ZodPipe(adminReasonSchema)) body: AdminReason, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    return this.data.blockPage(id, body, admin, request.ip);
  }

  @Post('users/:id/page/restore')
  @HttpCode(200)
  @AdminRoles(...WRITE_ROLES)
  restorePage(@Param('id') id: string, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    return this.data.restorePage(id, admin, request.ip);
  }

  @Get('users/:id/page/photos/:photoId')
  async pagePhoto(@Param('id') id: string, @Param('photoId') photoId: string, @Res() response: Response) {
    sendPrivateImage(response, await this.data.pagePhoto(id, photoId));
  }

  @Post('users/:id/page/photos/:photoId/remove')
  @HttpCode(200)
  @AdminRoles(...WRITE_ROLES)
  removePagePhoto(
    @Param('id') id: string,
    @Param('photoId') photoId: string,
    @Body(new ZodPipe(adminReasonSchema)) body: AdminReason,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.removePagePhoto(id, photoId, body, admin, request.ip);
  }

  @Get('users/:id/group-invites/:inviteId/qr')
  async groupQr(@Param('id') id: string, @Param('inviteId') inviteId: string, @Res() response: Response) {
    const image = await this.data.groupQr(id, inviteId);
    if (!image) throw apiError(HttpStatus.NOT_FOUND, 'GROUP_INVITE_NOT_FOUND', 'Group not found');
    sendPrivateImage(response, image);
  }

  @Post('users/:id/group-invites/:inviteId/remove')
  @HttpCode(200)
  @AdminRoles(...WRITE_ROLES)
  removeGroupInvite(
    @Param('id') id: string,
    @Param('inviteId') inviteId: string,
    @Body(new ZodPipe(adminReasonSchema)) body: AdminReason,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.removeGroupInvite(id, inviteId, body, admin, request.ip);
  }

  @Put('users/:id/profile')
  @AdminRoles(...WRITE_ROLES)
  saveUserProfile(
    @Param('id') id: string,
    @Body(new ZodPipe(driverProfileSchema)) body: DriverProfileInput,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.saveUserProfile(id, body, admin, request.ip);
  }

  // ---- orders

  @Post('orders/:id/cancel')
  @HttpCode(200)
  @AdminRoles(...WRITE_ROLES)
  cancelOrder(@Param('id') id: string, @Body(new ZodPipe(adminReasonSchema)) body: AdminReason, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    return this.data.cancelOrder(id, body, admin, request.ip);
  }

  @Get('orders')
  orders(@Query(new ZodPipe(adminOrderQuerySchema)) query: AdminOrderQuery, @CurrentAdmin() admin: AdminUser) {
    return this.data.listOrders(query, admin.role);
  }

  @Get('orders/:id')
  order(@Param('id') id: string, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    return this.data.getOrder(id, admin, request.ip);
  }

  // ---- billing control

  @Get('billing')
  @AdminRoles(...WRITE_ROLES)
  billing() {
    return this.data.billingCatalogue();
  }

  @Put('billing/plans/:planKey/features/:featureKey')
  @AdminRoles(...WRITE_ROLES)
  setPlanFeature(
    @Param('planKey') planKey: string,
    @Param('featureKey') featureKey: string,
    @Body(new ZodPipe(adminPlanFeatureSchema)) body: AdminPlanFeature,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.setPlanFeature(planKey, featureKey, body, admin, request.ip);
  }

  @Post('billing/policies')
  @AdminRoles(...WRITE_ROLES)
  createPolicy(
    @Body(new ZodPipe(adminPolicyCreateSchema)) body: AdminPolicyCreate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.createPolicy(body, admin, request.ip);
  }

  @Patch('billing/policies/:id')
  @AdminRoles(...WRITE_ROLES)
  updatePolicy(
    @Param('id') id: string,
    @Body(new ZodPipe(adminPolicyUpdateSchema)) body: AdminPolicyUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    return this.data.updatePolicy(id, body, admin, request.ip);
  }

  @Get('billing/service-fee')
  @AdminRoles(...WRITE_ROLES)
  serviceFee() {
    return this.commission.status();
  }

  @Put('billing/service-fee')
  @AdminRoles(...WRITE_ROLES)
  async updateServiceFee(
    @Body(new ZodPipe(commissionUpdateSchema)) body: CommissionUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    const status = await this.commission.update(body, `admin:${admin.username}`);
    await this.audit.log({ adminId: admin.id, action: 'billing.serviceFee', detail: body, ip: request.ip });
    return status;
  }

  // ---- 登入配置 → 開發模式登入

  @Get('settings/phone-login-development')
  @AdminRoles(...WRITE_ROLES)
  developmentLoginStatus() {
    return this.developmentLogin.status();
  }

  @Post('settings/phone-login-development')
  @HttpCode(200)
  @AdminRoles('SUPER_ADMIN')
  async updateDevelopmentLogin(
    @Body(new ZodPipe(developmentLoginUpdateSchema)) body: DevelopmentLoginUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    const status = await this.developmentLogin.update(body, `admin:${admin.username}`);
    // Record that the code changed, never the code itself.
    await this.audit.log({
      adminId: admin.id,
      action: 'settings.developmentLogin',
      detail: { enabled: body.enabled ?? null, codeChanged: body.code !== undefined },
      ip: request.ip,
    });
    return status;
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
@AdminRoles('SUPER_ADMIN')
export class AdminAccountsController {
  constructor(
    @Inject(AdminAuthService) private readonly auth: AdminAuthService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  @Get('accounts')
  accounts() {
    return this.auth.listAccounts();
  }

  @Post('accounts')
  create(@Body(new ZodPipe(adminCreateSchema)) body: AdminCreate, @CurrentAdmin() admin: AdminUser) {
    return this.auth.createAccount(body, admin.id);
  }

  @Post('accounts/:id/reset-password')
  @HttpCode(200)
  resetPassword(@Param('id') id: string, @CurrentAdmin() admin: AdminUser) {
    return this.auth.resetPassword(id, admin);
  }

  @Post('accounts/:id/disable')
  @HttpCode(200)
  disable(@Param('id') id: string, @CurrentAdmin() admin: AdminUser) {
    return this.auth.setDisabled(id, true, admin);
  }

  @Post('accounts/:id/enable')
  @HttpCode(200)
  enable(@Param('id') id: string, @CurrentAdmin() admin: AdminUser) {
    return this.auth.setDisabled(id, false, admin);
  }

  @Get('audit')
  auditLog(@Query(new ZodPipe(adminAuditQuerySchema)) query: AdminAuditQuery) {
    return this.audit.list(query);
  }
}
