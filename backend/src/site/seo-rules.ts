/**
 * Pages that carry trip or account data. They are never indexed, whatever the
 * SEO settings say: the claim page, the passenger page, a 拼車 link and a
 * passenger's seats (the platform never lists a carpool), the driver app, the
 * admin and the API.
 */
export const ALWAYS_PRIVATE_PATHS = ['/o/', '/c/', '/r/', '/s/', '/app', '/admin', '/api/'] as const;

export const TEMPLATE_VARIABLES = ['司機', '路線', '車型', '地區'] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const SEPARATOR = '[｜|·・—–-]';
const MISSING = '\u0000';

/**
 * Fills {司機}, {路線}, {車型}, {地區} in a title or description template.
 * A missing value is dropped together with the separator it would leave
 * dangling, so "{司機}｜{路線}｜跨境師傅幫" without a route reads "李師傅｜跨境師傅幫".
 */
export function renderSeoTemplate(template: string, values: Partial<Record<TemplateVariable, string | null>>): string {
  return template
    .replace(/\{([^{}]+)\}/g, (_, name: string) => values[name as TemplateVariable]?.trim() || MISSING)
    .replace(new RegExp(`${MISSING}\\s*${SEPARATOR}\\s*`, 'g'), '')
    .replace(new RegExp(`\\s*${SEPARATOR}\\s*${MISSING}`, 'g'), '')
    .replaceAll(MISSING, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

export interface RobotsInput {
  allowIndexing: boolean;
  sitemapEnabled: boolean;
  canonicalOrigin: string;
}

export function robotsTxt(input: RobotsInput): string {
  const lines = ['User-agent: *'];
  if (!input.allowIndexing) {
    lines.push('Disallow: /');
  } else {
    for (const path of ALWAYS_PRIVATE_PATHS) lines.push(`Disallow: ${path}`);
    if (input.sitemapEnabled && input.canonicalOrigin) lines.push('', `Sitemap: ${input.canonicalOrigin}/sitemap.xml`);
  }
  return `${lines.join('\n')}\n`;
}

/** The robots meta value for a public page type; private pages are always noindex. */
export function robotsMeta(allowIndexing: boolean): string {
  return allowIndexing ? 'index, follow' : 'noindex, nofollow';
}
