import { z } from 'zod';

/** Empty, or an https:// URL. Anything else (javascript:, http:) is rejected. */
const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => value === '' || /^https:\/\/[^\s]+$/i.test(value), { message: 'HTTPS_URL_REQUIRED' });

/** Site-verification tokens and analytics ids are plain identifiers, never markup. */
const token = z
  .string()
  .trim()
  .max(120)
  .regex(/^[A-Za-z0-9_\-=.]*$/, 'PLAIN_TOKEN_REQUIRED');

const text = (max: number) => z.string().trim().max(max);

export const appSettingUpdateSchema = z
  .object({
    upgradeUrl: httpsUrl,
    supportWechatId: text(60),
    supportWhatsapp: text(30),
    termsText: text(20_000),
    privacyText: text(20_000),
    announcementText: text(300),
    announcementEnabled: z.boolean(),
  })
  .partial();
export type AppSettingUpdate = z.infer<typeof appSettingUpdateSchema>;

export const seoSiteUpdateSchema = z
  .object({
    canonicalOrigin: httpsUrl.refine((value) => value === '' || !/\/$/.test(value), { message: 'NO_TRAILING_SLASH' }),
    googleVerification: token,
    bingVerification: token,
    baiduVerification: token,
    baiduTongjiId: token,
    allowIndexing: z.boolean(),
    sitemapEnabled: z.boolean(),
  })
  .partial();
export type SeoSiteUpdate = z.infer<typeof seoSiteUpdateSchema>;

export const SEO_PAGES = ['HOME', 'PROFILE'] as const;
export type SeoPageKey = (typeof SEO_PAGES)[number];

export const seoPageUpdateSchema = z
  .object({
    title: text(120),
    description: text(300),
    keywords: text(200),
    shareImageUrl: httpsUrl,
  })
  .partial();
export type SeoPageUpdate = z.infer<typeof seoPageUpdateSchema>;

export const AD_POSITIONS = ['CLAIM_PAGE', 'HOME', 'MY_ORDERS'] as const;
export type AdPositionKey = (typeof AD_POSITIONS)[number];

const isoDate = z.string().datetime({ offset: true });

export const adCreateSchema = z.object({
  position: z.enum(AD_POSITIONS),
  title: text(60).min(1),
  body: text(200).default(''),
  imageUrl: httpsUrl.default(''),
  linkUrl: httpsUrl.refine((value) => value !== '', { message: 'LINK_REQUIRED' }),
  priority: z.number().int().min(0).max(1000).default(0),
  active: z.boolean().default(true),
  startsAt: isoDate.optional(),
  endsAt: isoDate.nullable().optional(),
});
export type AdCreate = z.infer<typeof adCreateSchema>;

export const adUpdateSchema = z
  .object({
    position: z.enum(AD_POSITIONS),
    title: text(60).min(1),
    body: text(200),
    imageUrl: httpsUrl,
    linkUrl: httpsUrl.refine((value) => value !== '', { message: 'LINK_REQUIRED' }),
    priority: z.number().int().min(0).max(1000),
    active: z.boolean(),
    startsAt: isoDate,
    endsAt: isoDate.nullable(),
  })
  .partial();
export type AdUpdate = z.infer<typeof adUpdateSchema>;

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'CONVERTED', 'NOT_INTERESTED'] as const;
export type LeadStatusKey = (typeof LEAD_STATUSES)[number];

export const leadUpdateSchema = z
  .object({ status: z.enum(LEAD_STATUSES), note: text(2000) })
  .partial()
  .refine((value) => value.status !== undefined || value.note !== undefined, { message: 'NOTHING_TO_UPDATE' });
export type LeadUpdate = z.infer<typeof leadUpdateSchema>;

export const leadsQuerySchema = z.object({
  status: z.enum(LEAD_STATUSES).optional(),
  days: z.coerce.number().int().min(7).max(90).default(30),
});
export type LeadsQuery = z.infer<typeof leadsQuerySchema>;

export const adPositionQuerySchema = z.object({ position: z.enum(AD_POSITIONS) });
