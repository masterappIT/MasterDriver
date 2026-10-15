/**
 * What a chat app shows when a 名片頁 or a passenger's confirmation link is pasted: a small page of
 * preview tags (only link-preview robots are sent here, see deploy/frontend/web.conf) and a
 * 1200 × 630 card drawn as SVG. Pure functions, so what may appear on a card can be tested without
 * a database or an image library.
 *
 * Layout A (approved 2026-10-15): the car photo on the left 560px, or the driver's initial on the
 * brand gradient when there is none; the driver's facts on the right; the brand mark at the bottom
 * right. A card shows only what the 名片頁 itself shows publicly (no plate numbers), and the
 * confirmation card nothing of the trip or the passenger: the trip is in the message text that
 * comes with the link, which must read on its own wherever no preview is shown (WeChat, a slow
 * network), docs/DESIGN.md.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const PHOTO_WIDTH = 560;

export interface CardData {
  /** 司機名片 on a 名片頁 link, 為你安排的行程 on a confirmation link. */
  kind: 'profile' | 'confirm';
  name: string;
  /** 「7座商務車 · 兩地牌」: vehicle and plate kind, never the plate numbers. */
  vehicle: string | null;
  /**
   * A 名片頁 card only, and only what the public page shows: the languages they speak and the start
   * of their own introduction. Never routes or regions, which 名片頁 dropped on 2026-10-14 (old
   * values are still stored, but no longer shown or editable).
   */
  languages?: string[];
  intro?: string | null;
  /**
   * On a 名片頁 card the trips they drove; on a confirmation card the trips they arranged
   * (put out and completed, whoever drove), which is what 為你安排 speaks of.
   */
  completedTrips: number;
  /**
   * A confirmation card's word for the passenger: the dispatcher answers for the trip, and, when
   * their 名片頁 is public, the passenger can book them directly next time. The customer stays
   * theirs whoever drives (2026-10-15).
   */
  owner?: { line: string; next: string | null } | null;
  /** The car photo as a data: URL, already cropped to PHOTO_WIDTH × CARD_HEIGHT; null draws the initial. */
  photo: string | null;
}

export interface PreviewMeta {
  title: string;
  description: string;
  /** Where the link opens, and the card image; both full addresses. */
  url: string;
  image: string;
}

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** The page a link-preview robot reads: the tags and nothing else. People are never sent here. */
export function previewHtml(meta: PreviewMeta): string {
  const tags = [
    ['property', 'og:site_name', '跨境師傅幫 MasterDriver'],
    ['property', 'og:type', 'website'],
    ['property', 'og:title', meta.title],
    ['property', 'og:description', meta.description],
    ['property', 'og:url', meta.url],
    ['property', 'og:image', meta.image],
    ['property', 'og:image:width', String(CARD_WIDTH)],
    ['property', 'og:image:height', String(CARD_HEIGHT)],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'description', meta.description],
    ['name', 'robots', 'noindex, nofollow'],
  ];
  return [
    '<!doctype html>',
    '<html lang="zh-Hant"><head><meta charset="utf-8" />',
    `<title>${escape(meta.title)}</title>`,
    ...tags.map(([attribute, key, value]) => `<meta ${attribute}="${key}" content="${escape(value)}" />`),
    `</head><body><a href="${escape(meta.url)}">${escape(meta.title)}</a></body></html>`,
  ].join('\n');
}

/** Roughly how wide a line is, for sizing a pill: CJK a full em, Latin and digits about half. */
function textWidth(text: string, size: number) {
  let width = 0;
  for (const char of text) width += /[⺀-￿]/.test(char) ? size : size * 0.58;
  return width;
}

/** Breaks text into at most `lines` lines of `max` pixels; the last is cut with an ellipsis if more remains. */
export function wrap(text: string, size: number, max: number, lines: number) {
  const out: string[] = [];
  let rest = text.replace(/\s+/g, ' ').trim();
  while (rest && out.length < lines) {
    if (out.length === lines - 1 || textWidth(rest, size) <= max) {
      out.push(fit(rest, size, max));
      break;
    }
    let line = '';
    for (const char of rest) {
      if (textWidth(line + char, size) > max) break;
      line += char;
    }
    out.push(line);
    rest = rest.slice(line.length).trim();
  }
  return out;
}

/** Cuts a line that would run past `max` pixels, ending it with an ellipsis. */
export function fit(text: string, size: number, max: number) {
  if (textWidth(text, size) <= max) return text;
  let out = '';
  for (const char of text) {
    if (textWidth(`${out}${char}…`, size) > max) break;
    out += char;
  }
  return `${out}…`;
}

const FONT = "'PingFang TC','Noto Sans CJK TC','Noto Sans TC','Microsoft JhengHei',sans-serif";
const MARK_PATHS = [
  'M33.9404 28.3711V29.5554L34.919 30.1218L35.949 29.5554V28.3711L34.919 27.8047L33.9404 28.3711Z',
  'M30.1289 0C23.6396 0 17.9743 3.24391 14.5237 8.13551C6.43779 8.34147 0 14.9323 0 23.0678C0 31.3062 6.6953 38 14.9357 38C15.0387 38 15.1417 38 15.2447 38H29.9743C30.0258 38 30.0774 38 30.1289 38C30.1804 38 30.2319 38 30.2834 38H30.4379C40.7898 37.8455 49.1332 29.4011 49.1332 19C49.1332 8.49595 40.6353 0 30.1289 0ZM13.0816 27.8049L8.9614 26.5176L17.2533 12.3577L21.3735 13.645L13.0816 27.8049ZM16.2232 26.5176L24.5151 12.3577L28.6353 13.645L20.3434 27.8049L16.2232 26.5176ZM37.6482 30.5339L34.9186 32.0786L32.1889 30.5339V27.393L33.7855 26.4661V17.0949L27.5537 27.8049L23.4336 26.5176L31.7254 12.3577L35.8456 13.645H36.1031V26.5176L37.6997 27.4444V30.5339H37.6482Z',
];

/** The card as SVG. Text is drawn by the server's fonts (Noto Sans CJK in the API image). */
export function cardSvg(card: CardData): string {
  const left = PHOTO_WIDTH + 44;
  const column = CARD_WIDTH - left - 40;
  const parts: string[] = [];
  let y = 92;

  const text = (content: string, size: number, weight: number, fill: string, at = y, x = left) =>
    `<text x="${x}" y="${at}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escape(fit(content, size, column - (x - left) * 2))}</text>`;

  parts.push(text(card.kind === 'profile' ? '司機名片' : '為你安排的行程', 26, 800, '#0e9f9a'));
  y += 78;
  parts.push(text(card.name, 56, 800, '#142033'));
  y += 22;

  const facts = [card.vehicle, card.kind === 'profile' && card.languages?.length ? `會說${card.languages.join('、')}` : null].filter(Boolean).join(' · ');
  if (facts) {
    y += 50;
    parts.push(text(facts, 25, 600, '#34445a'));
  }
  if (card.kind === 'profile' && card.intro?.trim()) {
    // Their own words, two lines at most, set off by a teal rule as on the page.
    // The lines are indented 16px; text() allows a line that much less on each side, so wrap to the same.
    const lines = wrap(card.intro, 24, column - 32, 2);
    y += 22;
    parts.push(`<rect x="${left}" y="${y}" width="4" height="${lines.length * 36}" rx="2" fill="#d8f1ef" />`);
    lines.forEach((line, index) => parts.push(text(line, 24, 400, '#34445a', y + 27 + index * 36, left + 16)));
    y += lines.length * 36;
  }
  if (card.completedTrips > 0) {
    const label = card.kind === 'confirm' ? `已在師傅幫安排 ${card.completedTrips} 趟` : `已在師傅幫完成 ${card.completedTrips} 張`;
    y += 30;
    const width = textWidth(label, 24) + 32;
    parts.push(`<rect x="${left}" y="${y}" width="${width}" height="44" rx="22" fill="#fff3d6" />`);
    parts.push(text(label, 24, 700, '#8a5a00', y + 31, left + 16));
    y += 44;
  }
  if (card.kind === 'confirm' && card.owner) {
    const height = card.owner.next ? 92 : 60;
    y += 22;
    parts.push(`<rect x="${left}" y="${y}" width="${column}" height="${height}" rx="18" fill="#eef4fd" />`);
    parts.push(text(card.owner.line, 25, 700, '#142033', y + 39, left + 20));
    if (card.owner.next) parts.push(text(card.owner.next, 21, 600, '#556579', y + 74, left + 20));
    y += height;
  }
  {
    // What opening the link does: book on a 名片頁, confirm on a confirmation link.
    const label = card.kind === 'confirm' ? '點開連結，確認時間與上車地點' : '點開直接約車，不用註冊';
    y += 26;
    const width = Math.min(textWidth(label, 26) + 48, column);
    parts.push(`<rect x="${left}" y="${y}" width="${width}" height="64" rx="32" fill="#1f5fd6" />`);
    parts.push(text(label, 26, 800, '#ffffff', y + 42, left + 24));
    y += 64;
  }

  // The brand at the bottom of the column: the cloud M on its tile, 跨境師傅幫 over MasterDriver.
  const markY = CARD_HEIGHT - 82;
  // A short card sits in the middle of the room above the brand rather than bunched at the top.
  const top = 66;
  const offset = Math.max(0, (markY - 40 - y - (top - 40)) / 2);
  const content = `<g transform="translate(0 ${Math.round(offset)})">${parts.join('')}</g>`;
  parts.length = 0;
  parts.push(content);
  parts.push(
    `<rect x="${left}" y="${markY}" width="42" height="42" rx="12" fill="url(#brand)" />`,
    `<g transform="translate(${left + 6.5} ${markY + 10.5}) scale(0.58)">${MARK_PATHS.map((d) => `<path d="${d}" fill="#fff" />`).join('')}</g>`,
    `<text x="${left + 54}" y="${markY + 21}" font-family="${FONT}" font-size="21" font-weight="800" fill="#142033" letter-spacing="0.8">跨境師傅幫</text>`,
    `<text x="${left + 54}" y="${markY + 38}" font-family="${FONT}" font-size="11" font-weight="700" fill="#556579" letter-spacing="1.1">MasterDriver</text>`,
  );

  const initial = escape([...card.name.trim()][0] ?? '師');
  const side = card.photo
    ? [
        `<image href="${card.photo}" x="0" y="0" width="${PHOTO_WIDTH}" height="${CARD_HEIGHT}" preserveAspectRatio="xMidYMid slice" />`,
        // A darker lower edge, so photos of different light read alike.
        `<rect x="0" y="${CARD_HEIGHT * 0.55}" width="${PHOTO_WIDTH}" height="${CARD_HEIGHT * 0.45}" fill="url(#shade)" />`,
      ]
    : [
        `<rect x="0" y="0" width="${PHOTO_WIDTH}" height="${CARD_HEIGHT}" fill="url(#brand)" />`,
        `<circle cx="${PHOTO_WIDTH / 2}" cy="${CARD_HEIGHT / 2}" r="132" fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-opacity="0.6" stroke-width="4" />`,
        `<text x="${PHOTO_WIDTH / 2}" y="${CARD_HEIGHT / 2 + 52}" text-anchor="middle" font-family="${FONT}" font-size="150" font-weight="800" fill="#ffffff">${initial}</text>`,
      ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`,
    '<defs>',
    '<linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f5fd6" /><stop offset="1" stop-color="#0e9f9a" /></linearGradient>',
    '<linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0a1423" stop-opacity="0" /><stop offset="1" stop-color="#0a1423" stop-opacity="0.45" /></linearGradient>',
    '</defs>',
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#ffffff" />`,
    ...side,
    ...parts,
    '</svg>',
  ].join('');
}
