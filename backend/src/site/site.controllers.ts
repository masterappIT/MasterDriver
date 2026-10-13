import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Inject, Param, Patch, Post, Put, Query, Req, Res, UseGuards } from '@nestjs/common';
import {
  adCreateSchema,
  adPositionQuerySchema,
  adUpdateSchema,
  appSettingUpdateSchema,
  leadUpdateSchema,
  leadsQuerySchema,
  limitSettingUpdateSchema,
  SEO_PAGES,
  seoPageUpdateSchema,
  seoSiteUpdateSchema,
  siteLogoUpdateSchema,
  type AdCreate,
  type AdUpdate,
  type AppSettingUpdate,
  type LeadUpdate,
  type LeadsQuery,
  type LimitSettingUpdate,
  type SeoPageKey,
  type SeoPageUpdate,
  type SeoSiteUpdate,
  type SiteLogoUpdate,
} from '@masterdriver/shared';
import type { Request, Response } from 'express';
import type { Prisma } from '../../generated/prisma';
import { z } from 'zod';
import type { AdminUser } from '../admin/admin-auth.service';
import { AdminGuard, AdminRoles, CurrentAdmin } from '../admin/admin.guard';
import { AuditService } from '../admin/audit.service';
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
