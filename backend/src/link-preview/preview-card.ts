/**
 * What a chat app shows when a 名片頁 or a passenger's confirmation link is pasted: a small page of
 * preview tags (only link-preview robots are sent here, see deploy/frontend/web.conf) and a
 * 1200 × 630 card drawn as SVG. Pure functions, so what may appear on a card can be tested without
 * a database or an image library.
 *
 * Version C (approved 2026-10-15): the left 560px is a fixed frame on the brand gradient. The whole
 * car photo fits in its middle (never cut, whatever its size), with the brand mark in the band
 * above and the car's plate places (「香港」「粵Z」, never numbers) in the band below; without a
 * photo, the driver's initial. The driver's facts fill the right, centred top to bottom.
 * A card shows only what the 名片頁 itself shows publicly (no plate numbers), and the
 * confirmation card nothing of the trip or the passenger: the trip is in the message text that
 * comes with the link, which must read on its own wherever no preview is shown (WeChat, a slow
 * network), docs/DESIGN.md.
 */

export const CARD_WIDTH = 1200;
export const CARD_HEIGHT = 630;
export const PHOTO_WIDTH = 560;
/** The photo's space in the frame, between the two brand bands. */
export const PHOTO_HEIGHT = 420;
const BAND = (CARD_HEIGHT - PHOTO_HEIGHT) / 2;

export interface CardData {
  /** 司機名片 on a 名片頁 link, 為你安排的行程 on a confirmation link. */
  kind: 'profile' | 'confirm';
  name: string;
  /**
   * The car in a line on the right: 「埃爾法・黑」 on a 名片頁 card (its plates and seats are in the
   * band), 「7座商務車 · 兩地牌」 on a confirmation card when the dispatcher drives it. Never numbers.
   */
  vehicle: string | null;
  /** The band under the photo: where the plates are from, and 「兩地牌・7座」. Null leaves it plain. */
  plates?: { regions: string[]; label: string | null } | null;
  /** 名片頁 card: the ways to reach them the page shows, as labels, never the numbers. */
  contacts?: { whatsapp: boolean; wechat: boolean; phone: boolean } | null;
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
  /** The whole car photo as a data: URL, fitted inside PHOTO_WIDTH × PHOTO_HEIGHT; null draws the initial. */
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
  const column = CARD_WIDTH - left - 44;
  const text = (content: string, x: number, y: number, size: number, weight: number, fill: string, max = column - (x - left), anchor = 'start') =>
    `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">${escape(fit(content, size, max))}</text>`;
  const pill = (label: string, x: number, y: number, size: number, fill: string, ink: string) => {
    const width = textWidth(label, size) + size * 1.3;
    return { width, svg: `<rect x="${x}" y="${y}" width="${width}" height="${size * 1.9}" rx="${size * 0.95}" fill="${fill}" />${text(label, x + size * 0.65, y + size * 1.32, size, 700, ink, width)}` };
  };

  // ---- The right column: blocks stacked with their heights, then the whole set centred.
  const blocks: { height: number; gap: number; draw: (top: number) => string }[] = [];
  const add = (height: number, gap: number, draw: (top: number) => string) => blocks.push({ height, gap, draw });

  add(30, 0, (top) => text(card.kind === 'profile' ? '司機名片' : '為你安排的行程', left, top + 24, 24, 800, '#0e9f9a'));
  add(68, 14, (top) => text(card.name, left, top + 58, 64, 800, '#142033'));
  const facts = [card.vehicle, card.kind === 'profile' && card.languages?.length ? `會說${card.languages.join('、')}` : null].filter(Boolean).join(' · ');
  if (facts) add(32, 18, (top) => text(facts, left, top + 26, 26, 600, '#34445a'));
  if (card.kind === 'profile' && card.intro?.trim()) {
    const lines = wrap(card.intro, 23, column - 36, 2);
    add(lines.length * 34 + 24, 22, (top) =>
      [`<rect x="${left}" y="${top}" width="${column}" height="${lines.length * 34 + 24}" rx="14" fill="#f3f6fa" />`,
        ...lines.map((line, index) => text(line, left + 18, top + 36 + index * 34, 23, 400, '#34445a', column - 36))].join(''),
    );
  }
  // How to reach them (名片頁) and how much they have done, as small labels on one line.
  const chips: { label: string; fill: string; ink: string }[] = [];
  if (card.kind === 'profile' && card.contacts) {
    if (card.contacts.whatsapp) chips.push({ label: 'WhatsApp', fill: '#dcf5e6', ink: '#137044' });
    if (card.contacts.wechat) chips.push({ label: '微信', fill: '#e5edfb', ink: '#1f5fd6' });
    if (card.contacts.phone) chips.push({ label: '電話', fill: '#e5edfb', ink: '#1f5fd6' });
  }
  if (card.completedTrips > 0) {
    chips.push({
      label: card.kind === 'confirm' ? `已在師傅幫安排 ${card.completedTrips} 趟` : `已完成 ${card.completedTrips} 張`,
      fill: '#fff3d6',
      ink: '#8a5a00',
    });
  }
  if (chips.length) {
    add(40, 22, (top) => {
      const parts: string[] = [];
      let x = left;
      if (card.kind === 'profile' && card.contacts) {
        parts.push(text('可用', x, top + 28, 20, 600, '#8f9db0'));
        x += 52;
      }
      for (const chip of chips) {
        const drawn = pill(chip.label, x, top, 21, chip.fill, chip.ink);
        if (x + drawn.width > left + column) break;
        parts.push(drawn.svg);
        x += drawn.width + 10;
      }
      return parts.join('');
    });
  }
  if (card.kind === 'confirm' && card.owner) {
    const owner = card.owner;
    const height = owner.next ? 92 : 60;
    add(height, 22, (top) =>
      [`<rect x="${left}" y="${top}" width="${column}" height="${height}" rx="18" fill="#eef4fd" />`,
        text(owner.line, left + 20, top + 39, 25, 700, '#142033', column - 40),
        owner.next ? text(owner.next, left + 20, top + 74, 21, 600, '#556579', column - 40) : ''].join(''),
    );
  }
  // What opening the link does, as a button across the column.
  const action = card.kind === 'confirm' ? '點開連結，確認時間與上車地點' : '點開直接約車，不用註冊';
  add(72, 26, (top) =>
    `<rect x="${left}" y="${top}" width="${column}" height="72" rx="36" fill="#1f5fd6" />${text(action, left + column / 2, top + 46, 27, 800, '#ffffff', column - 40, 'middle')}`,
  );

  const total = blocks.reduce((sum, block, index) => sum + block.height + (index ? block.gap : 0), 0);
  let top = Math.max(36, (CARD_HEIGHT - total) / 2);
  const right = blocks.map((block, index) => {
    if (index) top += block.gap;
    const svg = block.draw(Math.round(top));
    top += block.height;
    return svg;
  });

  // ---- The left frame: the brand above, the whole photo (or the initial), the plates below.
  const markWidth = 54 + textWidth('跨境師傅幫', 24);
  const markX = (PHOTO_WIDTH - markWidth) / 2;
  const frame = [
    `<rect x="0" y="0" width="${PHOTO_WIDTH}" height="${CARD_HEIGHT}" fill="url(#brand)" />`,
    `<g transform="translate(${markX} ${BAND / 2 - 15}) scale(0.82)">${MARK_PATHS.map((d) => `<path d="${d}" fill="#fff" />`).join('')}</g>`,
    text('跨境師傅幫', markX + 54, BAND / 2 + 9, 24, 800, '#ffffff', 200),
  ];
  if (card.photo) {
    frame.push(`<image href="${card.photo}" x="0" y="${BAND}" width="${PHOTO_WIDTH}" height="${PHOTO_HEIGHT}" preserveAspectRatio="xMidYMid meet" />`);
  } else {
    const initial = escape([...card.name.trim()][0] ?? '師');
    frame.push(
      `<circle cx="${PHOTO_WIDTH / 2}" cy="${CARD_HEIGHT / 2}" r="132" fill="#ffffff" fill-opacity="0.16" stroke="#ffffff" stroke-opacity="0.6" stroke-width="4" />`,
      `<text x="${PHOTO_WIDTH / 2}" y="${CARD_HEIGHT / 2 + 52}" text-anchor="middle" font-family="${FONT}" font-size="150" font-weight="800" fill="#ffffff">${initial}</text>`,
    );
  }
  if (card.plates && (card.plates.regions.length || card.plates.label)) {
    // Drawn like the plates: Hong Kong gold, Macau and mainland black (docs/DESIGN.md, 車牌顯示).
    const tags = card.plates.regions.map((region) => ({ region, width: textWidth(region, 24) + 32 }));
    const labelWidth = card.plates.label ? textWidth(card.plates.label, 22) : 0;
    const width = tags.reduce((sum, tag) => sum + tag.width + 12, 0) + labelWidth;
    let x = (PHOTO_WIDTH - width) / 2;
    const y = CARD_HEIGHT - BAND / 2 - 22;
    for (const tag of tags) {
      const hk = tag.region === '香港';
      frame.push(
        `<rect x="${x}" y="${y}" width="${tag.width}" height="44" rx="8" fill="${hk ? '#f5c518' : '#16191f'}" stroke="${hk ? 'rgba(23,23,23,0.55)' : 'rgba(255,255,255,0.7)'}" stroke-width="2" />`,
        text(tag.region, x + 16, y + 31, 24, 800, hk ? '#171717' : '#ffffff', tag.width),
      );
      x += tag.width + 12;
    }
    if (card.plates.label) frame.push(text(card.plates.label, x, y + 30, 22, 700, '#ffffff', labelWidth + 4));
  }

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${CARD_WIDTH}" height="${CARD_HEIGHT}" viewBox="0 0 ${CARD_WIDTH} ${CARD_HEIGHT}">`,
    '<defs>',
    '<linearGradient id="brand" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1f5fd6" /><stop offset="1" stop-color="#0e9f9a" /></linearGradient>',
    '</defs>',
    `<rect width="${CARD_WIDTH}" height="${CARD_HEIGHT}" fill="#ffffff" />`,
    ...frame,
    ...right,
    '</svg>',
  ].join('');
}

