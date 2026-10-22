/**
 * "一句話出單": reads an order written the way dispatchers already type it in
 * WeChat groups, e.g. "明天15:40澳门送香港，直车" or "6：20香机到南山 8座",
 * and pulls out the time, route, seats, people, luggage, price and notes. It
 * only proposes values: the dispatcher sees them and can correct them before
 * sending. Works on Traditional and Simplified Chinese. No dependencies, so the
 * web app, a future mini program and the API can all use it.
 */

export interface QuickOrder {
  /** ISO 8601 with +08:00, e.g. 2026-10-14T15:40:00+08:00. */
  pickupAt?: string;
  /** 即時單: "即時", "馬上", "而家" and the like; leaves now, so no time is needed. */
  immediate?: boolean;
  origin?: string;
  destination?: string;
  vehicleType?: string;
  passengers?: number;
  luggage?: number;
  price?: { amount: number; currency: 'HKD' | 'CNY' | 'MOP' };
  notes?: string;
  /** 往返: "往返", "來回" and the like; the order goes there and back. */
  roundTrip?: boolean;
  /**
   * 包鐘 (按小時計費): "包鐘 8 小時", "包8個鐘", "包車8小時", "包一日". A bare 包車 is not 包鐘: it
   * may mean the whole car at one price (特價車), so it stays a note. `minutes` only when the hours are said
   * (never guessed from 一日); `hourly` only for a price said to be an hour's ("每小時 250",
   * "250/小時"). Any other price stays in `price`, for the dispatcher to read: it may be a total.
   */
  charter?: { minutes?: number; hourly?: { amount: number; currency?: 'HKD' | 'CNY' | 'MOP' } };
  /** Which of time, origin and destination could not be read. */
  missing: ('pickupAt' | 'origin' | 'destination')[];
}

const HK_OFFSET_MS = 8 * 60 * 60 * 1000;
const pad = (value: number) => String(value).padStart(2, '0');

/** Full-width digits, colons and spaces, as typed on Chinese keyboards, made plain. */
function normalize(text: string) {
  return text
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/[：]/g, ':')
    .replace(/[　\s]+/g, ' ')
    .trim();
}

/** "現在 / 马上 / 而家": now. */
const NOW_WORDS = /(現在|现在|馬上|马上|即時|即时|而家|宜家|立即)/;

/** Removes the first match and returns its groups. */
function take(state: { text: string }, pattern: RegExp): RegExpMatchArray | null {
  const match = state.text.match(pattern);
  if (!match || match.index === undefined) return null;
  state.text = `${state.text.slice(0, match.index)} ${state.text.slice(match.index + match[0].length)}`;
  return match;
}

const PRICE_PATTERNS: { pattern: RegExp; currency: 'HKD' | 'CNY' | 'MOP' }[] = [
  { pattern: /(?:HK\$|HKD|港幣|港币|港元)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:港幣|港币|港元|蚊|HKD)/i, currency: 'HKD' },
  { pattern: /(?:MOP\$?|澳門幣|澳门币)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:澳門幣|澳门币|MOP)/i, currency: 'MOP' },
  { pattern: /(?:RMB|CNY|￥|¥|人民幣|人民币)\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:元|块|塊|人民幣|人民币|RMB|CNY)/i, currency: 'CNY' },
];

const VEHICLE_WORDS = /(埃爾法|埃尔法|阿爾法|阿尔法|alphard|威爾法|威尔法|商務車|商务车|保姆車|保姆车|七人車|七人车|豪華車|豪华车|轎車|轿车)/i;

/** Service words dispatchers add after the destination; kept as notes, not as part of the place. */
const SERVICE_WORDS = /(直車|直车|接駁|接驳|包車|包车|拼車|拼车|單程|单程|往返|來回|来回|專車|专车|順路|顺路|急單|急单|急)/g;

const ROUND_TRIP_WORDS = /(往返|來回|来回)/;

/** 包鐘: the word itself, or 包 (包車) straight before the hours or a day. */
const CHARTER_WORDS = /(包鐘|包钟|包[車车]?\s*(?=\d{1,2}(?:\.5)?\s*(?:個|个)?\s*(?:小時|小时|鐘|钟))|包[車车]?\s*(?:一|全|成)\s*(?:日|天))/;
/** 包鐘 hours: "8小時", "8.5 小时", "8個鐘", "8个钟头". */
const CHARTER_HOURS = /(\d{1,2}(?:\.5)?)\s*(?:個|个)?\s*(?:小時|小时|鐘頭|钟头|鐘|钟)/;
const CURRENCY_MARKS: { pattern: RegExp; currency: 'HKD' | 'CNY' | 'MOP' }[] = [
  { pattern: /HK\$|HKD|港幣|港币|港元|蚊/i, currency: 'HKD' },
  { pattern: /MOP\$?|澳門幣|澳门币/i, currency: 'MOP' },
  { pattern: /RMB|CNY|￥|¥|人民幣|人民币|元|块|塊/i, currency: 'CNY' },
];
const MONEY_MARK = '(?:HK\\$|HKD|MOP\\$?|RMB|CNY|￥|¥)?';
const MONEY_UNIT = '(?:港幣|港币|港元|蚊|澳門幣|澳门币|人民幣|人民币|元|块|塊|HKD|RMB|CNY|MOP)?';
const PER_HOUR = '(?:每小時|每小时|每個鐘|每个钟|時租|时租)';
const AN_HOUR = '(?:\\/|每|一)\\s*(?:小時|小时|個鐘|个钟|鐘|钟|h(?:r|our)?)';
/** 包鐘 price an hour: "每小時250", "每小时 HK$250", "250蚊一個鐘", "RMB300/小時". */
const HOURLY_PRICE = new RegExp(
  `${PER_HOUR}\\s*(${MONEY_MARK}\\s*\\d+(?:\\.\\d+)?\\s*${MONEY_UNIT})|(${MONEY_MARK}\\s*\\d+(?:\\.\\d+)?\\s*${MONEY_UNIT})\\s*${AN_HOUR}`,
  'i',
);

/** The amount and currency of a price as written; the currency only when it is said. */
function readHourly(written: string): { amount: number; currency?: 'HKD' | 'CNY' | 'MOP' } {
  const amount = Number(written.match(/\d+(?:\.\d+)?/)?.[0]);
  const currency = CURRENCY_MARKS.find(({ pattern }) => pattern.test(written))?.currency;
  return currency ? { amount, currency } : { amount };
}

const CONNECTOR = /\s*(?:送去|送到|送往|送至|送|到|去|往|至|→|->|－|—|➡️?)\s*/;
const CONNECTOR_ANYWHERE = new RegExp(CONNECTOR.source);

/** Days from today for words like 明天 / 後天. */
const DAY_WORDS: [RegExp, number][] = [
  [/(今天|今日|今晚|今早|今朝|今夜)/, 0],
  [/(明天|明日|明晚|明早|聽日|听日|聽朝|听朝)/, 1],
  [/(後天|后天|後日|后日)/, 2],
];

function hongKongParts(date: Date) {
  const local = new Date(date.getTime() + HK_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate() };
}

function isoAt(year: number, month: number, day: number, hour: number, minute: number) {
  // Normalize overflow (e.g. day 32) through Date.UTC, then express in Hong Kong time.
  const utc = Date.UTC(year, month - 1, day, hour, minute) - HK_OFFSET_MS;
  const local = new Date(utc + HK_OFFSET_MS);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}T${pad(local.getUTCHours())}:${pad(
    local.getUTCMinutes(),
  )}:00+08:00`;
}

function readTime(state: { text: string }, now: Date): string | undefined {
  // "現在 / 马上 / 而家": now, rounded up to the next five minutes.
  if (take(state, NOW_WORDS)) {
    const next = Math.ceil(now.getTime() / (5 * 60_000)) * 5 * 60_000;
    const local = new Date(next + HK_OFFSET_MS);
    return isoAt(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate(), local.getUTCHours(), local.getUTCMinutes());
  }

  const today = hongKongParts(now);
  let { year, month, day } = today;
  let dayGiven = false;
  let evening = false;

  const date = take(state, /(\d{1,2})\s*(?:\/|月)\s*(\d{1,2})\s*(?:日|號|号)?/);
  if (date) {
    month = Number(date[1]);
    day = Number(date[2]);
    dayGiven = true;
    // A date earlier in the year than today means next year.
    if (month < today.month || (month === today.month && day < today.day)) year += 1;
  } else {
    for (const [pattern, offset] of DAY_WORDS) {
      const word = take(state, pattern)?.[1];
      if (word) {
        day += offset;
        dayGiven = true;
        // 今晚 / 明晚 already say "evening".
        if (/晚|夜/.test(word)) evening = true;
        break;
      }
    }
  }

  const period = take(state, /(上午|早上|凌晨|中午|下午|晚上|夜晚|傍晚)/)?.[1];
  if (period && /下午|晚上|夜晚|傍晚/.test(period)) evening = true;
  const clock = take(state, /(\d{1,2})\s*(?::|點|点|時|时)\s*(\d{1,2}|半)?\s*(?:分)?/);
  if (!clock) return undefined;
  let hour = Number(clock[1]);
  const minute = clock[2] === '半' ? 30 : Number(clock[2] ?? 0);
  if (hour > 23 || minute > 59) return undefined;
  if (evening && hour < 12) hour += 12;
  if (period === '中午' && hour < 11) hour += 12;

  let iso = isoAt(year, month, day, hour, minute);
  // A bare time already passed today (by more than half an hour) means tomorrow.
  if (!dayGiven && new Date(iso).getTime() < now.getTime() - 30 * 60_000) iso = isoAt(year, month, day + 1, hour, minute);
  return iso;
}

const trimPlace = (value: string) =>
  value
    .replace(/^[\s,，。、;；:：从從由在]+/, '')
    .replace(/[\s,，。、;；:：]+$/, '')
    .trim();

export function parseQuickOrder(input: string, now: Date = new Date()): QuickOrder {
  const state = { text: normalize(input) };
  const result: QuickOrder = { missing: [] };

  // 包鐘 first: its hours ("8小時") would otherwise read as a clock or as children ("8小").
  if (CHARTER_WORDS.test(state.text)) {
    result.charter = {};
    take(state, /包[鐘钟]/);
    const hours = take(state, CHARTER_HOURS);
    const minutes = hours ? Math.round(Number(hours[1]) * 60) : 0;
    if (minutes >= 60 && minutes <= 24 * 60) result.charter.minutes = minutes;
    const hourly = take(state, HOURLY_PRICE);
    if (hourly) result.charter.hourly = readHourly(hourly[1] ?? hourly[2]);
    // "包8個鐘" leaves a lone 包 once the hours are taken; "包一日" says nothing more.
    take(state, /包[車车]?\s*(?:一|全|成)\s*(?:日|天)/);
    state.text = state.text.replace(/包(?=\s|$)/g, ' ');
  }

  for (const { pattern, currency } of PRICE_PATTERNS) {
    const match = take(state, pattern);
    if (match) {
      result.price = { amount: Number(match[1] ?? match[2]), currency };
      break;
    }
  }

  const seats = take(state, /(\d{1,2})\s*(?:座|seater)/i);
  const model = take(state, VEHICLE_WORDS);
  const vehicle = [model?.[1], seats ? `${seats[1]}座` : undefined].filter(Boolean).join(' ');
  if (vehicle) result.vehicleType = vehicle;

  const adults = take(state, /(\d{1,2})\s*(?:大人|個人|个人|位|人|大|pax)/i);
  const children = take(state, /(\d{1,2})\s*(?:小孩|小童|兒童|儿童|小)/);
  if (adults || children) result.passengers = Number(adults?.[1] ?? 0) + Number(children?.[1] ?? 0);

  const luggage = take(state, /(\d{1,2})\s*(?:件行李|個行李|个行李|件|箱|喼)/);
  if (luggage) result.luggage = Number(luggage[1]);

  // The words readTime takes as "now" make it a 即時單 too.
  if (NOW_WORDS.test(state.text)) result.immediate = true;
  result.pickupAt = readTime(state, now);

  // 往返 between two places ("深圳灣往返機場") reads as the way there; the word stays in the notes too.
  if (ROUND_TRIP_WORDS.test(state.text)) result.roundTrip = true;
  const between = state.text.match(new RegExp(`(\\S)\\s*(${ROUND_TRIP_WORDS.source})\\s*(?=\\S)`));
  if (between?.index !== undefined && !CONNECTOR_ANYWHERE.test(state.text.replace(ROUND_TRIP_WORDS, ''))) {
    state.text = `${state.text.slice(0, between.index + 1)} → ${state.text.slice(between.index + between[0].length)} ${between[2]}`;
  }

  // Whatever service words remain are notes ("直車", "接駁"); with 包鐘, 包車 is the order's type, not a note.
  const services = (state.text.match(SERVICE_WORDS) ?? []).filter((word) => !(result.charter && /包[車车]/.test(word)));
  state.text = state.text.replace(SERVICE_WORDS, ' ');

  const [before, ...afterParts] = state.text.split(CONNECTOR);
  if (afterParts.length > 0) {
    const after = afterParts.join(' ');
    const [destination, ...rest] = after.split(/[,，。;；]|\s{1,}/).filter((part) => part.trim());
    result.origin = trimPlace(before) || undefined;
    result.destination = destination ? trimPlace(destination) : undefined;
    const extra = rest.map(trimPlace).filter(Boolean);
    const notes = [...services, ...extra].join(' ').trim();
    if (notes) result.notes = notes;
  } else if (result.charter) {
    // 包鐘 often names only where the car is taken ("深圳灣口岸包車", "福田出發"): the 上車地點.
    const [place, ...rest] = state.text.split(/[,，。;；]|\s+/).map(trimPlace).filter(Boolean);
    const origin = place?.replace(/(上車|上车|出發|出发)$/, '');
    if (origin) result.origin = origin;
    const notes = [...services, ...rest].join(' ').trim();
    if (notes) result.notes = notes;
  } else {
    const notes = [...services, trimPlace(state.text)].filter(Boolean).join(' ').trim();
    if (notes) result.notes = notes;
  }

  if (!result.pickupAt && !result.immediate) result.missing.push('pickupAt');
  if (!result.origin) result.missing.push('origin');
  // 包鐘 may end where it started: no 結束地點 is not missing.
  if (!result.destination && !result.charter) result.missing.push('destination');
  return result;
}
