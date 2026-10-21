import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';
import { HOME, LinkPreviewService } from './link-preview.service';
import { escapeHtml, previewTags, type PreviewMeta } from './preview-card';

const PLATE_KIND = { SINGLE: '單牌', DUAL: '兩地牌', TRIPLE: '三地牌' } as const;
const CODE = /^[A-Za-z0-9_-]{4,64}$/;
/** What the home page says to a search engine: the landing page's own words, without its pictures. */
const HOME_WORDS = {
  heading: 'MasterDriver 跨境師傅幫',
  slogan: '有單就派，有空就接',
  lead: '跨境司機在微信群和 WhatsApp 群裡派單、搶單、請乘客確認的工具。',
  points: [
    '一條連結貼到幾個群，都是同一張單，司機點連結先到先得。',
    '你的名片頁，客人直接向你詢價、約車；價錢由你報，客人是你的。',
    '電話幾時給司機、車牌給不給乘客看，都由你決定。平台不把你的客人派給別人。',
    '中途換車可以分段派，乘客只確認一次。',
    '免費。一個人就能用。',
  ],
};

export interface SearchPage {
  html: string;
  /** Whether the page asks to be indexed; the response's X-Robots-Tag says the same. */
  indexable: boolean;
}

/**
 * What a search engine (Googlebot, Baiduspider, bingbot) gets for the home page and a 名片頁
 * (2026-10-22): the words written into the HTML, since the app draws them only with scripts, which
 * Baidu does not run and Google skips once index.html says noindex. Indexed only while the admin's
 * SEO setting allows it, and a 名片頁 only when it is published and its driver chose 讓搜尋引擎找到我;
 * every other path, and anything else, says noindex. A 名片頁 here never shows phone numbers. Link
 * previews (Facebook, WhatsApp) never come here: nginx sends them to LinkPreviewService as before.
 */
@Injectable()
export class SearchPageService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(LinkPreviewService) private readonly previews: LinkPreviewService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async page(path: string): Promise<SearchPage> {
    const site = await this.site();
    const clean = path.split(/[?#]/)[0].replace(/\/+$/, '') || '/';
    if (clean === '/') return this.home(site);
    const match = /^\/p\/([^/]+)$/.exec(clean);
    if (match && CODE.test(match[1])) {
      const profile = await this.profile(site, match[1]);
      if (profile) return profile;
    }
    return this.closed(site, clean);
  }

  /** The sitemap: the home page and every 名片頁 its driver let be found. Null while it is switched off. */
  async sitemap(): Promise<string | null> {
    const site = await this.site();
    if (!site.allowIndexing || !site.sitemapEnabled || !site.canonicalOrigin) return null;
    const pages = await this.prisma.profilePage.findMany({
      where: { published: true, searchable: true, blockedAt: null, user: { profile: { isNot: null } } },
      select: { code: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
      take: 45_000,
    });
    const url = (loc: string, lastmod?: Date) =>
      `<url><loc>${escapeHtml(loc)}</loc>${lastmod ? `<lastmod>${lastmod.toISOString().slice(0, 10)}</lastmod>` : ''}</url>`;
    return [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
      url(`${site.canonicalOrigin}/`),
      ...pages.map((page) => url(`${site.canonicalOrigin}/p/${page.code}`, page.updatedAt)),
      '</urlset>',
      '',
    ].join('\n');
  }

  private async site() {
    const found = await this.prisma.seoSiteSetting.findUnique({ where: { id: 'default' } });
    return {
      allowIndexing: found?.allowIndexing ?? false,
      sitemapEnabled: found?.sitemapEnabled ?? false,
      canonicalOrigin: found?.canonicalOrigin || '',
      origin: found?.canonicalOrigin || this.config.publicBaseUrl,
      verification: [
        ['google-site-verification', found?.googleVerification],
        ['msvalidate.01', found?.bingVerification],
        ['baidu-site-verification', found?.baiduVerification],
      ].filter((pair): pair is [string, string] => Boolean(pair[1])),
    };
  }

  private async home(site: Awaited<ReturnType<SearchPageService['site']>>): Promise<SearchPage> {
    const settings = await this.prisma.seoPageSetting.findUnique({ where: { page: 'HOME' } });
    const title = settings?.title || HOME.title;
    const description = settings?.description || HOME.description;
    const url = `${site.origin}/`;
    const body = [
      `<h1>${escapeHtml(HOME_WORDS.heading)}</h1>`,
      `<p>${escapeHtml(HOME_WORDS.slogan)}</p>`,
      `<p>${escapeHtml(HOME_WORDS.lead)}</p>`,
      `<ul>${HOME_WORDS.points.map((point) => `<li>${escapeHtml(point)}</li>`).join('')}</ul>`,
      `<p><a href="${escapeHtml(`${site.origin}/login`)}">開始使用</a>・<a href="${escapeHtml(`${site.origin}/legal/terms`)}">服務條款</a>・<a href="${escapeHtml(`${site.origin}/legal/privacy`)}">私隱政策</a></p>`,
    ];
    const meta: PreviewMeta = { title, description, url, image: `${this.config.publicBaseUrl}${HOME.image}`, square: false };
    // The site's verification codes go on the home page, where Google, Bing and Baidu look for them.
    return this.render({ meta, keywords: settings?.keywords || '', indexable: site.allowIndexing, verification: site.verification, body });
  }

  /** A published 名片頁 not taken down; null for anything else, which gets the closed page. */
  private async profile(site: Awaited<ReturnType<SearchPageService['site']>>, code: string): Promise<SearchPage | null> {
    const page = await this.prisma.profilePage.findUnique({
      where: { code },
      select: {
        userId: true,
        published: true,
        searchable: true,
        blockedAt: true,
        intro: true,
        languages: true,
        user: { select: { profile: { select: { name: true, vehicleType: true, color: true, seats: true, plateType: true } } } },
      },
    });
    if (!page?.published || page.blockedAt || !page.user.profile) return null;
    // The same title, description and picture the link preview has.
    const preview = await this.previews.page(`/p/${code}`);
    const profile = page.user.profile;
    const url = `${site.origin}/p/${code}`;
    const indexable = site.allowIndexing && page.searchable;
    const car = [profile.vehicleType, profile.color, profile.plateType ? PLATE_KIND[profile.plateType] : null, profile.seats ? `${profile.seats} 座` : null]
      .filter(Boolean)
      .join('・');
    const completed = await this.prisma.order.count({ where: { claimedById: page.userId, status: 'COMPLETED' } });
    const body = indexable
      ? [
          `<h1>${escapeHtml(`${profile.name || '司機'}｜跨境司機名片`)}</h1>`,
          car ? `<p>${escapeHtml(car)}</p>` : '',
          page.languages.length ? `<p>${escapeHtml(`會說${page.languages.join('、')}`)}</p>` : '',
          page.intro ? `<p>${escapeHtml(page.intro)}</p>` : '',
          completed > 0 ? `<p>${escapeHtml(`在跨境師傅幫已完成 ${completed} 張單`)}</p>` : '',
          // No phone numbers here: a passenger opens the page to reach the driver.
          `<p><a href="${escapeHtml(url)}">打開名片頁，直接約車，不用註冊</a></p>`,
        ].filter(Boolean)
      : [`<p><a href="${escapeHtml(url)}">${escapeHtml(preview.title)}</a></p>`];
    return this.render({ meta: { ...preview, url }, keywords: '', indexable, verification: [], body });
  }

  private closed(site: Awaited<ReturnType<SearchPageService['site']>>, path: string): SearchPage {
    const meta: PreviewMeta = { title: HOME.title, description: HOME.description, url: `${site.origin}${path}`, image: `${this.config.publicBaseUrl}${HOME.image}`, square: false };
    return this.render({ meta, keywords: '', indexable: false, verification: [], body: [] });
  }

  private render(input: { meta: PreviewMeta; keywords: string; indexable: boolean; verification: [string, string][]; body: string[] }): SearchPage {
    const { meta } = input;
    const html = [
      '<!doctype html>',
      '<html lang="zh-Hant"><head><meta charset="utf-8" />',
      '<meta name="viewport" content="width=device-width, initial-scale=1" />',
      `<title>${escapeHtml(meta.title)}</title>`,
      input.keywords ? `<meta name="keywords" content="${escapeHtml(input.keywords)}" />` : '',
      `<meta name="robots" content="${input.indexable ? 'index, follow' : 'noindex, nofollow'}" />`,
      input.indexable ? `<link rel="canonical" href="${escapeHtml(meta.url)}" />` : '',
      ...input.verification.map(([name, content]) => `<meta name="${name}" content="${escapeHtml(content)}" />`),
      // The description and the og: tags, as the link preview has them.
      ...previewTags(meta),
      '</head><body>',
      ...input.body,
      '</body></html>',
      '',
    ].filter(Boolean);
    return { html: html.join('\n'), indexable: input.indexable };
  }
}
