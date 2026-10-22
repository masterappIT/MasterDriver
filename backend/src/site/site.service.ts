import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdCreate,
  AdPositionKey,
  AdUpdate,
  AppInterestAnswer,
  AppInterestChoice,
  AppSettingUpdate,
  LeadUpdate,
  LeadsQuery,
  SeoPageKey,
  SeoPageUpdate,
  LimitSettingUpdate,
  SeoSiteUpdate,
  UpdateNoticeLanguage,
} from '@masterdriver/shared';
import { APP_INTEREST_CHOICES } from '@masterdriver/shared';
import type { Prisma } from '../../generated/prisma';
import { apiError } from '../common/errors';
import { retryFirstWrite } from '../common/first-write';
import { readLimits } from '../common/limits';
import { decodeQrImage } from '../groups/qr-image';
import { PrismaService } from '../prisma.service';
import { robotsMeta, robotsTxt } from './seo-rules';

const DEFAULT_ID = 'default';
const DAY_MS = 24 * 60 * 60 * 1000;
/** The 升級 entry in 我的 shows only for drivers who put out more than this many trips in 30 days (2026-10-14). */
const UPGRADE_MIN_TRIPS = 30;
const MAX_IMPRESSION_IDS = 10;
/** 一般設定 lists this many of the latest App 意向問卷 notes. */
const APP_INTEREST_NOTES_SHOWN = 100;

/** Calendar day in Hong Kong, e.g. "2026-10-13". */
function hongKongDay(now: Date) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

const iso = (date: Date | null) => date?.toISOString() ?? null;

/**
 * General settings, SEO and ads. Admin writes are audited by the caller; the
 * public reads only expose what the driver app and public pages need.
 */
@Injectable()
export class SiteService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  // ---------------------------------------------------------- general settings

  appSetting() {
    return retryFirstWrite(() => this.prisma.appSetting.upsert({ where: { id: DEFAULT_ID }, update: {}, create: { id: DEFAULT_ID } }));
  }

  async updateAppSetting(input: AppSettingUpdate, actor: string) {
    await this.appSetting();
    return this.prisma.appSetting.update({ where: { id: DEFAULT_ID }, data: { ...input, updatedBy: actor } });
  }

  // ------------------------------------------------------------ 防濫用設定

  limits() {
    return readLimits(this.prisma);
  }

  async updateLimits(input: LimitSettingUpdate, actor: string) {
    await this.limits();
    return this.prisma.limitSetting.update({ where: { id: DEFAULT_ID }, data: { ...input, updatedBy: actor } });
  }

  /** Where the public pages load the logo from; the version changes when the logo does, so browsers refetch it. */
  private async logoUrl() {
    const logo = await this.prisma.siteLogo.findUnique({ where: { id: DEFAULT_ID }, select: { updatedAt: true } });
    return logo ? `/api/public/logo?v=${logo.updatedAt.getTime()}` : null;
  }

  async logoStatus() {
    return { logoUrl: await this.logoUrl() };
  }

  /** The same rules as other uploaded pictures: a real PNG, JPEG or WebP, at most 400 KB. */
  async setLogo(dataUrl: string, actor: string) {
    const image = decodeQrImage(dataUrl);
    if (!image) throw apiError(HttpStatus.BAD_REQUEST, 'LOGO_IMAGE_INVALID', 'Upload a PNG, JPEG or WebP image up to 400 KB');
    const data = { mime: image.mime, image: image.bytes, updatedBy: actor };
    await retryFirstWrite(() => this.prisma.siteLogo.upsert({ where: { id: DEFAULT_ID }, update: data, create: { id: DEFAULT_ID, ...data } }));
    return this.logoStatus();
  }

  async removeLogo() {
    await this.prisma.siteLogo.deleteMany({ where: { id: DEFAULT_ID } });
    return this.logoStatus();
  }

  logoImage() {
    return this.prisma.siteLogo.findUnique({ where: { id: DEFAULT_ID }, select: { mime: true, image: true } });
  }

  // ------------------------------------------------------------ 更新說明彈窗

  private updateNotice() {
    return retryFirstWrite(() => this.prisma.updateNotice.upsert({ where: { id: DEFAULT_ID }, update: {}, create: { id: DEFAULT_ID } }));
  }

  /** Where the app loads each picture from; the version is in the URL, so a new picture is never served from cache. */
  private noticeImages(notice: { version: number; hantMime: string | null; hansMime: string | null }) {
    const url = (language: UpdateNoticeLanguage) => `/api/public/update-notice/${language}?v=${notice.version}`;
    return { hant: notice.hantMime ? url('zh-Hant') : null, hans: notice.hansMime ? url('zh-Hans') : null };
  }

  /** What 一般設定 shows: the pictures, the switch, and how many users closed the notice of this version. */
  async updateNoticeStatus() {
    const notice = await this.updateNotice();
    const [seen, users] = await Promise.all([
      notice.version > 0 ? this.prisma.user.count({ where: { updateNoticeSeen: { gte: notice.version } } }) : 0,
      this.prisma.user.count({ where: { suspendedAt: null } }),
    ]);
    return { enabled: notice.enabled, version: notice.version, images: this.noticeImages(notice), seen, users, updatedAt: notice.updatedAt.toISOString() };
  }

  /** A new picture is a new notice: the version goes up, so every driver sees it once more. */
  async setUpdateNoticeImage(language: UpdateNoticeLanguage, dataUrl: string, actor: string) {
    const image = decodeQrImage(dataUrl);
    if (!image) throw apiError(HttpStatus.BAD_REQUEST, 'NOTICE_IMAGE_INVALID', 'Upload a PNG, JPEG or WebP image up to 400 KB');
    await this.updateNotice();
    const picture = language === 'zh-Hans' ? { hansMime: image.mime, hansImage: image.bytes } : { hantMime: image.mime, hantImage: image.bytes };
    await this.prisma.updateNotice.update({ where: { id: DEFAULT_ID }, data: { ...picture, version: { increment: 1 }, updatedBy: actor } });
    return this.updateNoticeStatus();
  }

  /** On or off; the version stays, so a driver who closed it does not see it again. */
  async setUpdateNoticeEnabled(enabled: boolean, actor: string) {
    const notice = await this.updateNotice();
    if (enabled && !notice.hantMime) throw apiError(HttpStatus.BAD_REQUEST, 'NOTICE_IMAGE_MISSING', 'Upload the Traditional picture first');
    await this.prisma.updateNotice.update({ where: { id: DEFAULT_ID }, data: { enabled, updatedBy: actor } });
    return this.updateNoticeStatus();
  }

  async updateNoticeImage(language: UpdateNoticeLanguage) {
    const notice = await this.prisma.updateNotice.findUnique({ where: { id: DEFAULT_ID } });
    if (!notice) return null;
    return language === 'zh-Hans'
      ? notice.hansMime && notice.hansImage && { mime: notice.hansMime, image: notice.hansImage }
      : notice.hantMime && notice.hantImage && { mime: notice.hantMime, image: notice.hantImage };
  }

  /**
   * The notice for this user, when it is on and they have not closed this version. Simplified users get
   * the Simplified picture when there is one; the app picks it, the Traditional one is always there.
   */
  async updateNoticeFor(userId: string) {
    const notice = await this.prisma.updateNotice.findUnique({
      where: { id: DEFAULT_ID },
      select: { enabled: true, version: true, hantMime: true, hansMime: true },
    });
    if (!notice?.enabled || notice.version === 0 || !notice.hantMime) return { notice: null };
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { updateNoticeSeen: true } });
    if (!user || user.updateNoticeSeen >= notice.version) return { notice: null };
    return { notice: { version: notice.version, images: this.noticeImages(notice) } };
  }

  /** Closed: never again for this version, on any phone. An older version never undoes a newer one. */
  async closeUpdateNotice(userId: string, version: number) {
    const notice = await this.prisma.updateNotice.findUnique({ where: { id: DEFAULT_ID }, select: { version: true } });
    // Never past the notice there is, so the next new picture still shows.
    const upTo = Math.min(version, notice?.version ?? 0);
    if (upTo < 1) return;
    await this.prisma.user.updateMany({ where: { id: userId, updateNoticeSeen: { lt: upTo } }, data: { updateNoticeSeen: upTo } });
  }

  // ------------------------------------------------------------ App 意向問卷

  private appInterestSurvey() {
    return retryFirstWrite(() => this.prisma.appInterestSurvey.upsert({ where: { id: DEFAULT_ID }, update: {}, create: { id: DEFAULT_ID } }));
  }

  /** Asked once: only while it is on, of a driver with a profile who has not answered or skipped it. */
  async appInterestFor(userId: string) {
    const survey = await this.prisma.appInterestSurvey.findUnique({ where: { id: DEFAULT_ID }, select: { enabled: true } });
    if (!survey?.enabled) return { ask: false };
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { profile: { select: { userId: true } }, appInterestAnswer: { select: { userId: true } } },
    });
    return { ask: Boolean(user?.profile && !user.appInterestAnswer) };
  }

  /** The first answer stays as given; another from a second phone, or after skipping, changes nothing. */
  async answerAppInterest(userId: string, input: AppInterestAnswer) {
    const answer = input.skipped ? { skipped: true } : { skipped: false, choices: input.choices, note: input.note };
    await this.prisma.appInterestAnswer.createMany({ data: [{ userId, ...answer }], skipDuplicates: true });
  }

  /** What 一般設定 shows: the switch, how many chose each kind, and the latest notes with who left them. */
  async appInterestStatus() {
    const survey = await this.appInterestSurvey();
    const drivers = { suspendedAt: null, profile: { isNot: null } } satisfies Prisma.UserWhereInput;
    const [answered, skipped, counts, users, waiting, notes] = await Promise.all([
      this.prisma.appInterestAnswer.count({ where: { skipped: false } }),
      this.prisma.appInterestAnswer.count({ where: { skipped: true } }),
      Promise.all(APP_INTEREST_CHOICES.map((choice) => this.prisma.appInterestAnswer.count({ where: { choices: { has: choice } } }))),
      this.prisma.user.count({ where: drivers }),
      this.prisma.user.count({ where: { ...drivers, appInterestAnswer: { is: null } } }),
      this.prisma.appInterestAnswer.findMany({
        where: { note: { not: '' } },
        orderBy: { createdAt: 'desc' },
        take: APP_INTEREST_NOTES_SHOWN,
        select: {
          userId: true,
          choices: true,
          note: true,
          createdAt: true,
          user: { select: { countryCode: true, phone: true, profile: { select: { name: true } } } },
        },
      }),
    ]);
    return {
      enabled: survey.enabled,
      answered,
      skipped,
      waiting,
      users,
      choices: Object.fromEntries(APP_INTEREST_CHOICES.map((choice, index) => [choice, counts[index]])) as Record<AppInterestChoice, number>,
      notes: notes.map((answer) => ({
        userId: answer.userId,
        name: answer.user.profile?.name ?? null,
        phone: `${answer.user.countryCode} ${answer.user.phone}`,
        choices: answer.choices,
        note: answer.note,
        createdAt: answer.createdAt.toISOString(),
      })),
      updatedAt: survey.updatedAt.toISOString(),
    };
  }

  /** On or off; answers stay, so a driver who answered is not asked again when it comes back on. */
  async setAppInterestEnabled(enabled: boolean, actor: string) {
    await this.appInterestSurvey();
    await this.prisma.appInterestSurvey.update({ where: { id: DEFAULT_ID }, data: { enabled, updatedBy: actor } });
    return this.appInterestStatus();
  }

  /**
   * The Master Travel 升級 entry in 我的: the admin's link, only for a driver who put out more than
   * 30 trips in the last 30 days. A 接駁 trip counts once (its first leg), and cancelled orders do not count.
   */
  async upgradeOffer(userId: string, now = new Date()) {
    const setting = await this.appSetting();
    if (!setting.upgradeUrl) return { upgradeUrl: null };
    const trips = await this.prisma.order.count({
      where: {
        dispatcherId: userId,
        createdAt: { gte: new Date(now.getTime() - 30 * DAY_MS) },
        status: { not: 'CANCELLED' },
        OR: [{ journeyId: null }, { legIndex: 1 }],
      },
    });
    return { upgradeUrl: trips > UPGRADE_MIN_TRIPS ? setting.upgradeUrl : null };
  }

  async publicSettings() {
    const setting = await this.appSetting();
    return {
      logoUrl: await this.logoUrl(),
      upgradeUrl: setting.upgradeUrl || null,
      support: { wechatId: setting.supportWechatId || null, whatsapp: setting.supportWhatsapp || null },
      announcement: setting.announcementEnabled && setting.announcementText ? setting.announcementText : null,
    };
  }

  async legalText(kind: 'terms' | 'privacy') {
    const setting = await this.appSetting();
    return { text: kind === 'terms' ? setting.termsText : setting.privacyText };
  }

  // ----------------------------------------------------------------------- SEO

  seoSite() {
    return retryFirstWrite(() => this.prisma.seoSiteSetting.upsert({ where: { id: DEFAULT_ID }, update: {}, create: { id: DEFAULT_ID } }));
  }

  async seoPages() {
    const pages = await Promise.all(
      (['HOME', 'PROFILE'] as const).map((page) =>
        retryFirstWrite(() => this.prisma.seoPageSetting.upsert({ where: { page }, update: {}, create: { page } })),
      ),
    );
    return Object.fromEntries(pages.map((page) => [page.page, page]));
  }

  async seoAll() {
    const [site, pages] = await Promise.all([this.seoSite(), this.seoPages()]);
    return { site, pages };
  }

  async updateSeoSite(input: SeoSiteUpdate, actor: string) {
    await this.seoSite();
    await this.prisma.seoSiteSetting.update({ where: { id: DEFAULT_ID }, data: { ...input, updatedBy: actor } });
    return this.seoAll();
  }

  async updateSeoPage(page: SeoPageKey, input: SeoPageUpdate) {
    await retryFirstWrite(() => this.prisma.seoPageSetting.upsert({ where: { page }, update: input, create: { page, ...input } }));
    return this.seoAll();
  }

  /** What a public page needs in its <head>. PROFILE fields are templates. */
  async publicSeo(page: SeoPageKey) {
    const [site, pages] = await Promise.all([this.seoSite(), this.seoPages()]);
    const settings = pages[page];
    return {
      title: settings.title,
      description: settings.description,
      keywords: settings.keywords,
      shareImageUrl: settings.shareImageUrl || null,
      robots: robotsMeta(site.allowIndexing),
      canonicalOrigin: site.canonicalOrigin || null,
      verification: {
        google: site.googleVerification || null,
        bing: site.bingVerification || null,
        baidu: site.baiduVerification || null,
      },
      baiduTongjiId: site.baiduTongjiId || null,
    };
  }

  async robots() {
    return robotsTxt(await this.seoSite());
  }

  // ----------------------------------------------------------------------- ads

  async listAds(now = new Date()) {
    const since = hongKongDay(new Date(now.getTime() - 30 * DAY_MS));
    const ads = await this.prisma.adSlot.findMany({
      orderBy: [{ position: 'asc' }, { priority: 'desc' }, { createdAt: 'desc' }],
      include: { stats: { where: { day: { gte: since } } } },
    });
    return ads.map(({ stats, ...ad }) => {
      const impressions = stats.reduce((sum, stat) => sum + stat.impressions, 0);
      const clicks = stats.reduce((sum, stat) => sum + stat.clicks, 0);
      return {
        ...ad,
        startsAt: ad.startsAt.toISOString(),
        endsAt: iso(ad.endsAt),
        createdAt: ad.createdAt.toISOString(),
        updatedAt: ad.updatedAt.toISOString(),
        live: ad.active && ad.startsAt <= now && (!ad.endsAt || ad.endsAt > now),
        last30Days: { impressions, clicks },
      };
    });
  }

  async createAd(input: AdCreate) {
    const ad = await this.prisma.adSlot.create({
      data: {
        ...input,
        startsAt: input.startsAt ? new Date(input.startsAt) : undefined,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
      },
    });
    return ad.id;
  }

  async updateAd(id: string, input: AdUpdate) {
    const { startsAt, endsAt, ...rest } = input;
    const updated = await this.prisma.adSlot.updateMany({
      where: { id },
      data: {
        ...rest,
        ...(startsAt === undefined ? {} : { startsAt: new Date(startsAt) }),
        ...(endsAt === undefined ? {} : { endsAt: endsAt === null ? null : new Date(endsAt) }),
      },
    });
    if (updated.count === 0) throw apiError(HttpStatus.NOT_FOUND, 'AD_NOT_FOUND', 'Ad not found');
  }

  async deleteAd(id: string) {
    const deleted = await this.prisma.adSlot.deleteMany({ where: { id } });
    if (deleted.count === 0) throw apiError(HttpStatus.NOT_FOUND, 'AD_NOT_FOUND', 'Ad not found');
  }

  /** Live ads for one place in the driver app, highest priority first. */
  async liveAds(position: AdPositionKey, now = new Date()) {
    const ads = await this.prisma.adSlot.findMany({
      where: { position, active: true, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 3,
    });
    return ads.map((ad) => ({
      id: ad.id,
      title: ad.title,
      body: ad.body,
      imageUrl: ad.imageUrl || null,
      clickUrl: `/api/public/ads/${ad.id}/click`,
    }));
  }

  async recordImpressions(ids: string[], now = new Date()) {
    const unique = [...new Set(ids)].slice(0, MAX_IMPRESSION_IDS);
    const existing = await this.prisma.adSlot.findMany({ where: { id: { in: unique } }, select: { id: true } });
    const day = hongKongDay(now);
    await Promise.all(
      existing.map(({ id }) =>
        retryFirstWrite(() =>
          this.prisma.adStat.upsert({
            where: { adId_day: { adId: id, day } },
            create: { adId: id, day, impressions: 1 },
            update: { impressions: { increment: 1 } },
          }),
        ),
      ),
    );
  }

  /** Counts the click and returns the ad's own stored link, so this is never an open redirect. */
  async click(id: string, now = new Date()): Promise<string | null> {
    const ad = await this.prisma.adSlot.findUnique({ where: { id }, select: { linkUrl: true } });
    if (!ad) return null;
    const day = hongKongDay(now);
    await retryFirstWrite(() =>
      this.prisma.adStat.upsert({
        where: { adId_day: { adId: id, day } },
        create: { adId: id, day, clicks: 1 },
        update: { clicks: { increment: 1 } },
      }),
    );
    return ad.linkUrl;
  }

  // --------------------------------------------------------------------- leads

  /**
   * Dispatchers most likely to need Master Travel, ranked by how much they
   * dispatch, how many drivers work their orders, how steadily, whether they
   * are growing and whether they already pay. The score is a sum of these
   * visible parts so sales can see why someone ranks high.
   */
  async leads(query: LeadsQuery, now = new Date()) {
    const since = new Date(now.getTime() - query.days * DAY_MS);
    const middle = new Date(now.getTime() - (query.days / 2) * DAY_MS);
    const rows = await this.prisma.$queryRaw<
      { userId: string; orders: bigint; completed: bigint; drivers: bigint; activeDays: bigint; recent: bigint; earlier: bigint }[]
    >`
      SELECT o."dispatcherId" AS "userId",
             COUNT(*) FILTER (WHERE o."status" <> 'CANCELLED') AS "orders",
             COUNT(*) FILTER (WHERE o."status" = 'COMPLETED') AS "completed",
             COUNT(DISTINCT o."claimedById") AS "drivers",
             COUNT(DISTINCT date_trunc('day', o."createdAt" + interval '8 hours')) AS "activeDays",
             COUNT(*) FILTER (WHERE o."createdAt" >= ${middle} AND o."status" <> 'CANCELLED') AS "recent",
             COUNT(*) FILTER (WHERE o."createdAt" < ${middle} AND o."status" <> 'CANCELLED') AS "earlier"
      FROM "Order" o
      WHERE o."createdAt" >= ${since}
      GROUP BY o."dispatcherId"
      ORDER BY "orders" DESC
      LIMIT 300`;
    const userIds = rows.map((row) => row.userId);
    const [users, topUps, subscriptions] = await Promise.all([
      this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, countryCode: true, phone: true, profile: { select: { name: true } }, lead: true },
      }),
      this.prisma.creditEntry.groupBy({
        by: ['userId'],
        where: { userId: { in: userIds }, type: 'TOPUP', createdAt: { gte: since } },
        _sum: { amountMinor: true },
      }),
      this.prisma.subscription.findMany({
        where: { userId: { in: userIds }, status: 'ACTIVE', OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        select: { userId: true, planKey: true },
      }),
    ]);
    const userById = new Map(users.map((user) => [user.id, user]));
    const topUpById = new Map(topUps.map((row) => [row.userId, (row._sum.amountMinor ?? 0) / 100]));
    const planById = new Map(subscriptions.map((row) => [row.userId, row.planKey]));

    const ranked = rows
      .map((row) => {
        const user = userById.get(row.userId);
        const orders = Number(row.orders);
        const drivers = Number(row.drivers);
        const activeDays = Number(row.activeDays);
        const growth = Number(row.recent) - Number(row.earlier);
        const toppedUp = topUpById.get(row.userId) ?? 0;
        const plan = planById.get(row.userId) ?? null;
        const parts = {
          orders,
          drivers: drivers * 3,
          activeDays: activeDays * 2,
          growth: Math.max(0, growth) * 2,
          paying: (toppedUp > 0 ? 10 : 0) + (plan ? 20 : 0),
        };
        return {
          userId: row.userId,
          name: user?.profile?.name ?? null,
          phone: user ? `${user.countryCode} ${user.phone}` : '',
          status: user?.lead?.status ?? 'NEW',
          note: user?.lead?.note ?? '',
          leadUpdatedAt: iso(user?.lead?.updatedAt ?? null),
          stats: { orders, completed: Number(row.completed), drivers, activeDays, growth, toppedUp, plan },
          score: Object.values(parts).reduce((sum, value) => sum + value, 0),
          scoreParts: parts,
        };
      })
      .filter((lead) => !query.status || lead.status === query.status)
      .sort((a, b) => b.score - a.score);
    return { days: query.days, items: ranked.slice(0, 100) };
  }

  async updateLead(userId: string, input: LeadUpdate, actor: string) {
    if (!(await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
      throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    }
    return this.prisma.lead.upsert({
      where: { userId },
      create: { userId, ...input, updatedBy: actor },
      update: { ...input, updatedBy: actor },
    });
  }
}
