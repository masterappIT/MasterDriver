import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  adCreateSchema,
  adPositionQuerySchema,
  adUpdateSchema,
  appInterestAnswerSchema,
  appInterestSettingSchema,
  appSettingUpdateSchema,
  leadUpdateSchema,
  leadsQuerySchema,
  limitSettingUpdateSchema,
  SEO_PAGES,
  seoPageUpdateSchema,
  seoSiteUpdateSchema,
  siteLogoUpdateSchema,
  UPDATE_NOTICE_LANGUAGES,
  updateNoticeImageSchema,
  updateNoticeSeenSchema,
  updateNoticeSettingSchema,
  type AdCreate,
  type AdUpdate,
  type AppInterestAnswer,
  type AppInterestSetting,
  type AppSettingUpdate,
  type LeadUpdate,
  type LeadsQuery,
  type LimitSettingUpdate,
  type SeoPageKey,
  type SeoPageUpdate,
  type SeoSiteUpdate,
  type SiteLogoUpdate,
  type UpdateNoticeImage,
  type UpdateNoticeLanguage,
  type UpdateNoticeSeen,
  type UpdateNoticeSetting,
} from '@masterdriver/shared';
import type { Request, Response } from 'express';
import type { Prisma } from '../../generated/prisma';
import { z } from 'zod';
import type { AdminUser } from '../admin/admin-auth.service';
import { AdminGuard, AdminRoles, CurrentAdmin } from '../admin/admin.guard';
import { AuditService } from '../admin/audit.service';
import { AuthGuard, CurrentUser } from '../auth/auth.guard';
import type { SessionUser } from '../auth/auth.service';
import { apiError } from '../common/errors';
import { ZodPipe } from '../common/zod-pipe';
import { SiteService } from './site.service';

const WRITE_ROLES = ['SUPER_ADMIN', 'OPERATOR'] as const;
const impressionsSchema = z.object({ ids: z.array(z.string().max(40)).max(10) });

function seoPage(value: string): SeoPageKey {
  if (!(SEO_PAGES as readonly string[]).includes(value)) throw apiError(HttpStatus.NOT_FOUND, 'SEO_PAGE_NOT_FOUND', 'Unknown page');
  return value as SeoPageKey;
}

/** Read-only data for the driver app and public pages. No sign-in. */
@Controller('public')
export class PublicSiteController {
  constructor(@Inject(SiteService) private readonly site: SiteService) {}

  @Get('settings')
  settings() {
    return this.site.publicSettings();
  }

  @Get('terms')
  terms() {
    return this.site.legalText('terms');
  }

  @Get('privacy')
  privacy() {
    return this.site.legalText('privacy');
  }

  @Get('logo')
  async logo(@Res() response: Response) {
    const logo = await this.site.logoImage();
    if (!logo) throw apiError(HttpStatus.NOT_FOUND, 'LOGO_NOT_FOUND', 'No logo has been uploaded');
    response
      .set({
        'content-type': logo.mime,
        // The URL carries a version, so a replaced logo is fetched again at once.
        'cache-control': 'public, max-age=86400',
        'x-content-type-options': 'nosniff',
      })
      // A Buffer is sent as the picture's bytes; the Uint8Array Prisma returns would be sent as JSON.
      .send(Buffer.from(logo.image));
  }

  /** 更新說明彈窗's picture; the URL carries the version, so it may be cached. */
  @Get('update-notice/:language')
  async updateNoticeImage(@Param('language') language: string, @Res() response: Response) {
    const picture = (UPDATE_NOTICE_LANGUAGES as readonly string[]).includes(language)
      ? await this.site.updateNoticeImage(language as UpdateNoticeLanguage)
      : null;
    if (!picture) throw apiError(HttpStatus.NOT_FOUND, 'NOTICE_IMAGE_NOT_FOUND', 'No picture has been uploaded');
    response
      .set({ 'content-type': picture.mime, 'cache-control': 'public, max-age=86400', 'x-content-type-options': 'nosniff' })
      .send(Buffer.from(picture.image));
  }

  @Get('seo/:page')
  seo(@Param('page') page: string) {
    return this.site.publicSeo(seoPage(page));
  }

  @Get('robots.txt')
  @Header('content-type', 'text/plain; charset=utf-8')
  robots() {
    return this.site.robots();
  }

  @Get('ads')
  ads(@Query(new ZodPipe(adPositionQuerySchema)) query: z.infer<typeof adPositionQuerySchema>) {
    return this.site.liveAds(query.position);
  }

  @Post('ads/impressions')
  @HttpCode(204)
  async impressions(@Body(new ZodPipe(impressionsSchema)) body: z.infer<typeof impressionsSchema>) {
    await this.site.recordImpressions(body.ids);
  }

  @Get('ads/:id/click')
  async click(@Param('id') id: string, @Res() response: Response) {
    const url = await this.site.click(id);
    if (!url) throw apiError(HttpStatus.NOT_FOUND, 'AD_NOT_FOUND', 'Ad not found');
    response.redirect(302, url);
  }
}

/** Whether 我的 shows the Master Travel 升級 entry; the rule is decided here, not in the page. */
@Controller('me/upgrade')
@UseGuards(AuthGuard)
export class UpgradeController {
  constructor(@Inject(SiteService) private readonly site: SiteService) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.site.upgradeOffer(user.id);
  }
}

/** 更新說明彈窗 for the signed-in driver: whether to show it, and closing it for good. */
@Controller('me/update-notice')
@UseGuards(AuthGuard)
export class UpdateNoticeController {
  constructor(@Inject(SiteService) private readonly site: SiteService) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.site.updateNoticeFor(user.id);
  }

  @Post('seen')
  @HttpCode(204)
  async seen(@CurrentUser() user: SessionUser, @Body(new ZodPipe(updateNoticeSeenSchema)) body: UpdateNoticeSeen) {
    await this.site.closeUpdateNotice(user.id, body.version);
  }
}

/** App 意向問卷 for the signed-in driver: whether to ask, and the answer (or skipping it), given once. */
@Controller('me/app-interest')
@UseGuards(AuthGuard)
export class AppInterestController {
  constructor(@Inject(SiteService) private readonly site: SiteService) {}

  @Get()
  get(@CurrentUser() user: SessionUser) {
    return this.site.appInterestFor(user.id);
  }

  @Post()
  @HttpCode(204)
  async answer(@CurrentUser() user: SessionUser, @Body(new ZodPipe(appInterestAnswerSchema)) body: AppInterestAnswer) {
    await this.site.answerAppInterest(user.id, body);
  }
}

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminSiteController {
  constructor(
    @Inject(SiteService) private readonly site: SiteService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private log(admin: AdminUser, action: string, request: Request, detail?: Prisma.InputJsonObject, targetId?: string) {
    return this.audit.log({ adminId: admin.id, action, targetId, detail, ip: request.ip });
  }

  // ---- 一般設定

  @Get('settings/general')
  @AdminRoles(...WRITE_ROLES)
  general() {
    return this.site.appSetting();
  }

  @Put('settings/general')
  @AdminRoles(...WRITE_ROLES)
  async updateGeneral(
    @Body(new ZodPipe(appSettingUpdateSchema)) body: AppSettingUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    const result = await this.site.updateAppSetting(body, `admin:${admin.username}`);
    // Record which fields changed; long texts are not copied into the log.
    await this.log(admin, 'settings.general', request, { fields: Object.keys(body) });
    return result;
  }

  // ---- 防濫用設定

  @Get('settings/limits')
  @AdminRoles(...WRITE_ROLES)
  limits() {
    return this.site.limits();
  }

  @Put('settings/limits')
  @AdminRoles(...WRITE_ROLES)
  async updateLimits(
    @Body(new ZodPipe(limitSettingUpdateSchema)) body: LimitSettingUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    const result = await this.site.updateLimits(body, `admin:${admin.username}`);
    // The new numbers are kept, so the log shows what each limit was changed to.
    await this.log(admin, 'settings.limits', request, { ...body });
    return result;
  }

  // ---- Logo

  @Get('settings/logo')
  @AdminRoles(...WRITE_ROLES)
  logo() {
    return this.site.logoStatus();
  }

  @Put('settings/logo')
  @AdminRoles(...WRITE_ROLES)
  async setLogo(@Body(new ZodPipe(siteLogoUpdateSchema)) body: SiteLogoUpdate, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.site.setLogo(body.image, `admin:${admin.username}`);
    await this.log(admin, 'settings.logo', request, { action: 'upload' });
    return result;
  }

  @Delete('settings/logo')
  @AdminRoles(...WRITE_ROLES)
  async removeLogo(@CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.site.removeLogo();
    await this.log(admin, 'settings.logo', request, { action: 'remove' });
    return result;
  }

  // ---- 更新說明彈窗

  @Get('settings/update-notice')
  @AdminRoles(...WRITE_ROLES)
  updateNotice() {
    return this.site.updateNoticeStatus();
  }

  @Put('settings/update-notice/image')
  @AdminRoles(...WRITE_ROLES)
  async setUpdateNoticeImage(@Body(new ZodPipe(updateNoticeImageSchema)) body: UpdateNoticeImage, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.site.setUpdateNoticeImage(body.language, body.image, `admin:${admin.username}`);
    await this.log(admin, 'settings.updateNotice', request, { action: 'upload', language: body.language, version: result.version });
    return result;
  }

  @Put('settings/update-notice')
  @AdminRoles(...WRITE_ROLES)
  async setUpdateNotice(@Body(new ZodPipe(updateNoticeSettingSchema)) body: UpdateNoticeSetting, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.site.setUpdateNoticeEnabled(body.enabled, `admin:${admin.username}`);
    await this.log(admin, 'settings.updateNotice', request, { action: body.enabled ? 'on' : 'off' });
    return result;
  }

  // ---- App 意向問卷

  @Get('settings/app-interest')
  @AdminRoles(...WRITE_ROLES)
  appInterest() {
    return this.site.appInterestStatus();
  }

  @Put('settings/app-interest')
  @AdminRoles(...WRITE_ROLES)
  async setAppInterest(@Body(new ZodPipe(appInterestSettingSchema)) body: AppInterestSetting, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const result = await this.site.setAppInterestEnabled(body.enabled, `admin:${admin.username}`);
    await this.log(admin, 'settings.appInterest', request, { action: body.enabled ? 'on' : 'off' });
    return result;
  }

  // ---- SEO

  @Get('seo')
  @AdminRoles(...WRITE_ROLES)
  seo() {
    return this.site.seoAll();
  }

  @Put('seo/site')
  @AdminRoles(...WRITE_ROLES)
  async updateSeoSite(
    @Body(new ZodPipe(seoSiteUpdateSchema)) body: SeoSiteUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    const result = await this.site.updateSeoSite(body, `admin:${admin.username}`);
    await this.log(admin, 'seo.site', request, body);
    return result;
  }

  @Put('seo/pages/:page')
  @AdminRoles(...WRITE_ROLES)
  async updateSeoPage(
    @Param('page') page: string,
    @Body(new ZodPipe(seoPageUpdateSchema)) body: SeoPageUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    const result = await this.site.updateSeoPage(seoPage(page), body);
    await this.log(admin, 'seo.page', request, { page, ...body });
    return result;
  }

  // ---- 廣告欄位

  @Get('ads')
  @AdminRoles(...WRITE_ROLES)
  ads() {
    return this.site.listAds();
  }

  @Post('ads')
  @AdminRoles(...WRITE_ROLES)
  async createAd(@Body(new ZodPipe(adCreateSchema)) body: AdCreate, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    const id = await this.site.createAd(body);
    await this.log(admin, 'ads.create', request, { title: body.title, position: body.position, linkUrl: body.linkUrl }, id);
    return this.site.listAds();
  }

  @Patch('ads/:id')
  @AdminRoles(...WRITE_ROLES)
  async updateAd(
    @Param('id') id: string,
    @Body(new ZodPipe(adUpdateSchema)) body: AdUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    await this.site.updateAd(id, body);
    await this.log(admin, 'ads.update', request, body, id);
    return this.site.listAds();
  }

  @Delete('ads/:id')
  @AdminRoles(...WRITE_ROLES)
  async deleteAd(@Param('id') id: string, @CurrentAdmin() admin: AdminUser, @Req() request: Request) {
    await this.site.deleteAd(id);
    await this.log(admin, 'ads.delete', request, undefined, id);
    return this.site.listAds();
  }

  // ---- 潛在客戶（所有角色可看；銷售也可以更新跟進狀態）

  @Get('leads')
  leads(@Query(new ZodPipe(leadsQuerySchema)) query: LeadsQuery) {
    return this.site.leads(query);
  }

  @Put('leads/:userId')
  async updateLead(
    @Param('userId') userId: string,
    @Body(new ZodPipe(leadUpdateSchema)) body: LeadUpdate,
    @CurrentAdmin() admin: AdminUser,
    @Req() request: Request,
  ) {
    const lead = await this.site.updateLead(userId, body, `admin:${admin.username}`);
    await this.audit.log({ adminId: admin.id, action: 'leads.update', targetType: 'user', targetId: userId, detail: { status: body.status ?? null }, ip: request.ip });
    return lead;
  }
}
