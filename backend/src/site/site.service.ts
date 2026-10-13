import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdCreate,
  AdPositionKey,
  AdUpdate,
  AppSettingUpdate,
  LeadUpdate,
  LeadsQuery,
  SeoPageKey,
  SeoPageUpdate,
  SeoSiteUpdate,
} from '@masterdriver/shared';
import { apiError } from '../common/errors';
import { PrismaService } from '../prisma.service';
import { robotsMeta, robotsTxt } from './seo-rules';

const DEFAULT_ID = 'default';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_IMPRESSION_IDS = 10;

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
    return this.prisma.appSetting.upsert({ where: { id: DEFAULT_ID }, update: {}, create: { id: DEFAULT_ID } });
  }

  async updateAppSetting(input: AppSettingUpdate, actor: string) {
    await this.appSetting();
    return this.prisma.appSetting.update({ where: { id: DEFAULT_ID }, data: { ...input, updatedBy: actor } });
  }

  async publicSettings() {
    const setting = await this.appSetting();
    return {
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
    return this.prisma.seoSiteSetting.upsert({ where: { id: DEFAULT_ID }, update: {}, create: { id: DEFAULT_ID } });
  }

  async seoPages() {
    const pages = await Promise.all(
      (['HOME', 'PROFILE'] as const).map((page) =>
        this.prisma.seoPageSetting.upsert({ where: { page }, update: {}, create: { page } }),
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
    await this.prisma.seoPageSetting.upsert({ where: { page }, update: input, create: { page, ...input } });
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
        this.prisma.adStat.upsert({
          where: { adId_day: { adId: id, day } },
          create: { adId: id, day, impressions: 1 },
          update: { impressions: { increment: 1 } },
        }),
      ),
    );
  }

  /** Counts the click and returns the ad's own stored link, so this is never an open redirect. */
  async click(id: string, now = new Date()): Promise<string | null> {
    const ad = await this.prisma.adSlot.findUnique({ where: { id }, select: { linkUrl: true } });
    if (!ad) return null;
    const day = hongKongDay(now);
    await this.prisma.adStat.upsert({
      where: { adId_day: { adId: id, day } },
      create: { adId: id, day, clicks: 1 },
      update: { clicks: { increment: 1 } },
    });
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
