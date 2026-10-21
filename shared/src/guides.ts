/**
 * 使用教學 (2026-10-22): public pages at /guide, one per feature, no account needed, so a driver can
 * be sent one link to read before signing in. Each page says what the feature is for and how it
 * helps a driver run their own business, then how to use it. Only the names and one-line summaries
 * live here, for the link previews, the search-engine page and the admin's 教學連結; the pages'
 * own words are in web/src/guides/content.ts, downloaded only when a guide is opened.
 */
export const GUIDE_INDEX = {
  title: '跨境師傅幫使用教學',
  description: '每個功能怎樣用、幫你做多少生意：出單派到群、搶單接單、特價車，一頁一個功能。',
} as const;

/** In reading order: the 目錄 lists them this way. */
export const GUIDES = [
  {
    slug: 'start',
    title: '開始使用',
    description: '驗證手機就能用，免費，不用下載 App。三步開始派單、接單。',
  },
  {
    slug: 'dispatch',
    title: '出單派到群',
    description: '接不了的單不用推掉：一條連結貼到幾個群，其他司機搶單，客人留在你手上。',
  },
  {
    slug: 'claim',
    title: '搶單接單',
    description: '在群裡點連結就能搶，先到先得，不用打字搶、不怕看漏，空檔和回程都接得到單。',
  },
  {
    slug: 'deal',
    title: '特價車',
    description: '開你自己的專屬路線，乘客用專屬連結直接向你下單，不經任何中介。',
  },
] as const;

export type GuideSlug = (typeof GUIDES)[number]['slug'];
export const GUIDE_SLUGS: readonly string[] = GUIDES.map((guide) => guide.slug);

/** The address of the 目錄 (no slug) or of one guide. */
export const guidePath = (slug?: GuideSlug) => (slug ? `/guide/${slug}` : '/guide');

/** A guide by the last part of its address; null for anything else. */
export const findGuide = (slug: string) => GUIDES.find((guide) => guide.slug === slug) ?? null;

/** The title a guide's link preview and browser tab show: short enough for a WeChat card's two lines. */
export const guidePageTitle = (slug?: GuideSlug) => {
  const guide = slug ? findGuide(slug) : null;
  return guide ? `${guide.title}｜跨境師傅幫使用教學` : GUIDE_INDEX.title;
};
