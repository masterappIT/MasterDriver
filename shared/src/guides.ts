/**
 * 使用教學 (2026-10-22): public pages at /guide, one per feature, no account needed, so a driver can
 * be sent one link to read before signing in. Each page says what the feature is for and how it
 * helps a driver run their own business, then how to use it. Only the names and one-line summaries
 * live here, for the link previews, the search-engine page and the admin's 教學連結; the pages'
 * own words are in web/src/guides/content.ts, downloaded only when a guide is opened.
 */
export const GUIDE_INDEX = {
  title: '跨境師傅幫使用教學',
  description: '每個功能怎樣用、幫你做多少生意：出單、搶單、包鐘、訂單收款、名片頁、特價車、拼車，一頁一個功能。',
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
    slug: 'charter',
    title: '包鐘',
    description: '按小時計的單：寫明幾多小時、每小時幾錢和超時怎樣計，自己做或派到群裡。',
  },
  {
    slug: 'deal',
    title: '特價車',
    description: '開你自己的專屬路線，乘客用專屬連結直接向你下單，不經任何中介。',
  },
  {
    slug: 'orders',
    title: '訂單與收款',
    description: '接的單、出的單都在「訂單」：行程一步一步按，收款、結清記在單上，車費不經平台。',
  },
  {
    slug: 'profile-page',
    title: '名片頁找客人',
    description: '一條屬於你的連結，放到朋友圈和小紅書，客人不用註冊就直接向你詢價、約車。',
  },
  {
    slug: 'carpool',
    title: '拼車',
    description: '一部車載幾組乘客：開一趟拼車發出連結，乘客自己報位，湊夠了自己開或派出去。',
  },
  {
    slug: 'contacts',
    title: '客人與司機',
    description: '出過單的乘客、接過你單的司機自動記下：熟客一按出單，常用司機先搶你的單。',
  },
  {
    slug: 'faq',
    title: '常見問題',
    description: '收費、通知、登入、乘客資料和聯絡客服，常被問到的一次看清楚。',
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
