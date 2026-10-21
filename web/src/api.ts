import { reactive } from 'vue';
import { adoptAccountLanguage, t } from './i18n';

const TOKEN_KEY = 'md-token';

export interface User {
  id: string;
  countryCode: string;
  phone: string;
  locale: string;
}

export interface Profile {
  name: string;
  /** Null on a profile saved before these were asked. */
  vehicleOwnership: 'HK' | 'MACAU' | 'MAINLAND' | null;
  plateType: 'SINGLE' | 'DUAL' | 'TRIPLE' | null;
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  vehicleType: string | null;
  seats: number | null;
  color: string | null;
  /** 港澳號碼 and 內地號碼 as stored: "+852 91234567", "+86 13800001111". */
  hkMacauPhone: string | null;
  mainlandPhone: string | null;
  /** The plates are not shown to passengers. */
  hidePlates: boolean;
}

export const session = reactive<{ user: User | null; profile: Profile | null; checked: boolean }>({
  user: null,
  profile: null,
  checked: false,
});

/**
 * The sign-in token lives in an httpOnly cookie set by the API and, as a
 * fallback, in localStorage: the WeChat browser sometimes clears one of them.
 */
export function storedToken() {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function rememberToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* the cookie still signs this browser in */
  }
}

const ERROR_TEXT: Record<string, string> = {
  VALIDATION_FAILED: '資料不正確，請檢查後再試',
  SIGN_IN_REQUIRED: '請先登入',
  OTP_TOO_FREQUENT: '驗證碼已發送，請稍後再申請',
  OTP_LIMIT_REACHED: '申請次數太多，請一小時後再試',
  OTP_INVALID: '驗證碼不正確或已過期',
  OTP_LOCKED: '錯誤次數太多，請重新申請驗證碼',
  SMS_NOT_CONFIGURED: '暫時無法發送簡訊，請聯絡客服',
  SMS_SEND_FAILED: '簡訊發送失敗，請稍後再試',
  ORDER_NOT_FOUND: '找不到這張單',
  CANNOT_CLAIM_OWN_ORDER: '不能搶自己出的單',
  PROFILE_REQUIRED: '請先填寫司機資料',
  ACCOUNT_SUSPENDED: '這個帳號已被停用，如有疑問請聯絡客服',
  TEAM_ONLY: '這張單只限車隊成員搶',
  INVALID_ORDER_STATUS: '這張單的狀態已經改變，請重新整理',
  DRIVER_PRICE_LOCKED: '已有司機接單，出單價不能再改',
  QUOTA_EXCEEDED: '本月出單額度已用完',
  FEATURE_NOT_AVAILABLE: '你目前的方案沒有這個功能',
  INSUFFICIENT_CREDITS: '點數不足，請先充值',
  QR_IMAGE_INVALID: '請上傳 400 KB 以內的 PNG、JPG 或 WebP 圖片',
  GROUP_INVITE_LIMIT: '最多只能加入 5 個群',
  GROUP_INVITE_NOT_FOUND: '找不到這個群',
  LEG_BEFORE_PREVIOUS: '第 2 段（或回程）的時間不能早於第 1 段（或去程）',
  ONE_LEG_PER_DRIVER: '一張接駁單，同一位司機只能接其中一段',
  FAVORITES_FIRST: '這張單先給出單者的常用司機搶，稍後才開放給所有人',
  NOTHING_CHANGED: '行程沒有改變',
  NOT_A_TRANSFER: '只有接駁單才有接駁位置',
  ONE_JOURNEY_KIND: '一張單只能選往返或接駁其中一種',
  SELF_DRIVE_BOTH_LEGS: '同一位司機來回時，自己做就是兩程都自己開',
  RETURN_TIME_REQUIRED: '往返請填回程時間',
  RETURN_BEFORE_PICKUP: '回程的時間要晚於去程',
  DRIVER_NOT_FOUND: '只能標記接過你的單的司機',
  TRIP_PRICE_ON_FIRST_LEG: '接駁單整張單只有一個乘客價，請在第 1 段修改',
  PROFILE_PAGE_NOT_FOUND: '找不到這個名片頁，或司機尚未公開',
  PROFILE_PAGE_BLOCKED: '你的名片頁已被平台下架，請聯絡客服',
  BOOKING_NOT_FOUND: '找不到這個預約',
  BOOKING_NOT_OPEN: '這個預約已經結束，不能再更改',
  BOOKING_IN_THE_PAST: '請選擇將來的時間',
  BOOKING_LIMIT: '今天送出的預約太多了，請直接聯絡司機',
  BOOKING_PAGE_FULL: '這位司機今天的預約已滿，請直接聯絡司機或明天再試',
  PHOTO_TYPE: '照片只接受 PNG、JPG 或 WebP',
  PHOTO_TOO_LARGE: '照片太大，上限 5 MB',
  PHOTO_LIMIT: '車輛照片只可以放一張，要換請先刪除現有的',
  PHOTO_NOT_FOUND: '找不到這張照片',
  SUPPORT_MEDIA_TYPE: '只能傳送圖片（PNG、JPG、WebP）或影片（MP4、MOV、WebM）',
  SUPPORT_MEDIA_TOO_LARGE: '檔案太大：圖片上限 5 MB，影片上限 25 MB',
  SUPPORT_MEDIA_LIMIT: '今天傳送的圖片和影片已達上限，請改用文字',
  SUPPORT_MEDIA_UNAVAILABLE: '暫時無法傳送圖片和影片，請先用文字',
  SUPPORT_MEDIA_NOT_FOUND: '檔案已過期或不存在',
  SUPPORT_VIDEO_SIGN_IN: '登入後才能傳送影片',
  SUPPORT_TOO_FAST: '訊息太頻密，請稍等一下再傳',
  SUPPORT_GUEST_LIMIT: '暫時無法開始新的訪客對話，請登入後再聯絡客服',
  VEHICLE_TYPE_REQUIRED: '請填車型，例如 7座',
  PASSENGER_NAME_REQUIRED: '請填乘客稱呼，例如 王小姐',
  HK_MACAU_PHONE_REQUIRED: '請填港澳號碼',
  MAINLAND_PHONE_REQUIRED: '請填內地號碼',
  NETWORK_UNSTABLE: '網路不穩，沒有載入成功，請稍後重新載入',
  CARPOOL_NOT_FOUND: '找不到這個拼車',
  CARPOOL_SEAT_NOT_FOUND: '找不到這個報位',
  CARPOOL_SEATS_REQUIRED: '請先在司機資料填上車的座位數',
  CARPOOL_TOO_MANY_SEATS: '座位數不能超過車的座位減去司機自己的一個',
  CARPOOL_SEATS_BELOW_HELD: '已報位的人數比新的座位數多，請先取消一些報位',
  CARPOOL_MIN_OVER_SEATS: '最少成行人數不能多過座位數',
  CARPOOL_IN_THE_PAST: '請選擇將來的出發時間',
  CARPOOL_CLOSES_AT_INVALID: '報位截止要在現在之後、出發時間或之前',
  CARPOOL_NOT_OPEN: '這個拼車已經成單或取消，不能再更改',
  CARPOOL_STILL_OPEN: '請先停止報位，才可以成單',
  CARPOOL_PENDING_SEATS: '還有報位等你確認，請先確認或婉拒',
  CARPOOL_RECONFIRM_PENDING: '還有乘客未接受新的時間或價錢，請等他們接受，或取消他們的報位',
  CARPOOL_NO_PASSENGERS: '還沒有已確認的乘客',
  CARPOOL_SEAT_NOT_PENDING: '這個報位已經不是等你確認的狀態',
  CARPOOL_SEAT_CLOSED: '這個報位已經不能再更改',
  CARPOOL_CLOSED: '這個拼車已截止報位',
  CARPOOL_PICKUP_POINT: '請選擇其中一個上車點',
  CARPOOL_TOO_MUCH_LUGGAGE: '行李超過司機訂的每位件數，請直接聯絡司機',
  CARPOOL_ALREADY_BOOKED: '這個電話已經報了這個拼車',
  CARPOOL_NOT_ENOUGH_SEATS: '剩下的座位不夠',
  CARPOOL_SEAT_LIMIT: '今天報位的次數太多了，請直接聯絡司機',
  CARPOOL_TRIP_FIXED: '拼車單的行程由乘客報位決定，不能修改；要改請取消後重開拼車',
  CARPOOL_PROGRESS_BY_PARTY: '拼車單請在每組乘客那裡分別回報',
  CARPOOL_WAIT_FIRST: '到了上車點之後，等過等候時間才可以按乘客沒出現',
  CARPOOL_PARTY_NO_SHOW: '這組已標記為沒出現',
  CARPOOL_PARTY_ON_BOARD: '這組乘客已上車',
  CARPOOL_PARTY_NOT_ON_BOARD: '這組乘客還沒上車',
  DEAL_NOT_FOUND: '找不到這個特價車',
  DEAL_NOT_OPEN: '這個特價車已關閉或過了時間，不能再預約或修改',
  DEAL_FULL: '這個特價車已接滿，請直接聯絡司機',
  DEAL_CANCELLED: '這個特價車已被平台下架',
  DEAL_IN_THE_PAST: '請選擇將來的時間',
  DEAL_WINDOW_INVALID: '時段要先開始後結束，最長 7 天',
  DEAL_ORIGINAL_NOT_ABOVE: '原價要比特價高；不想顯示原價就留空',
  DEAL_TIME_OUTSIDE: '請在司機定的時段內選出發時間',
  DEAL_TOO_MANY_PASSENGERS: '人數超過這個特價車的上限，請直接聯絡司機',
  DEAL_TOO_MUCH_LUGGAGE: '行李超過這個特價車的上限，請直接聯絡司機',
  DEAL_ALREADY_BOOKED: '這個電話已經預約了同一個時間',
  DEAL_PHONE_LIMIT: '這個電話今天預約的特價車太多了，請直接聯絡司機',
  DEAL_PRICE_FIXED: '特價車的預約按特價，不能另外報價',
  DEAL_MAX_BELOW_BOOKED: '最多接幾組不能少於已經預約的組數',
};

const INVALID_PHONE = 'INVALID_PHONE';

/** 往返 and 接駁 rules the schema checks; each reads as its own line in ERROR_TEXT. */
const JOURNEY_ISSUES = ['ONE_JOURNEY_KIND', 'SELF_DRIVE_BOTH_LEGS', 'RETURN_TIME_REQUIRED', 'RETURN_BEFORE_PICKUP'];
/** 特價車 rules the schema checks, read the same way. */
const DEAL_ISSUES = ['DEAL_WINDOW_INVALID', 'DEAL_ORIGINAL_NOT_ABOVE'];

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: Record<string, unknown> = {},
  ) {
    const issues = (detail.issues as { message: string }[] | undefined) ?? [];
    const messages = issues.map((issue) => issue.message);
    const text = messages.includes(INVALID_PHONE)
      ? '手機號碼格式不正確'
      : messages.includes('INVALID_PASSENGER_PHONE')
        ? '乘客電話格式不正確：請選區號，香港和澳門填 8 位數字，內地填 11 位手機號碼'
      : messages.includes('HK_MACAU_PHONE_INVALID')
        ? '港澳號碼格式不正確：香港 8 位手機號碼，澳門 6 字頭 8 位'
      : messages.includes('MAINLAND_PHONE_INVALID')
        ? '內地號碼格式不正確：請填 11 位手機號碼'
      : messages.includes('WHATSAPP_INVITE_INVALID')
        ? 'WhatsApp 群連結應該是 https://chat.whatsapp.com/ 開頭'
        : messages.includes('QR_IMAGE_REQUIRED')
          ? '請上傳二維碼圖片'
          : ERROR_TEXT[messages.find((message) => JOURNEY_ISSUES.includes(message) || DEAL_ISSUES.includes(message)) ?? code];
    super(text ?? `操作失敗（${code}）`);
  }
}

/**
 * Whether the connection is failing: set when a read gave up on the network, cleared by the next
 * answer. App.vue then shows a line with 重新載入, so a page never just waits forever.
 */
export const network = reactive({ unstable: false });

/**
 * Reads (GET) wait at most this long for an answer, and are tried again on a failed connection,
 * a timeout or a 502–504 from the front end (a waking server). From mainland China a connection
 * to the server can stall without failing; a fresh one usually goes through. Anything that changes
 * data is sent once and never repeated here, so nothing is done twice.
 */
export const READ_TIMEOUT_MS = 10_000;
export const READ_ATTEMPTS = 3;
const RETRY_AFTER_MS = [1_000, 2_000];

export const isRetryableStatus = (status: number) => status === 502 || status === 503 || status === 504;

/** An answer read in full: a stall while the body arrives counts against the same time limit. */
interface Answer {
  status: number;
  text: string;
}

async function readOnce(url: string, init: RequestInit): Promise<Answer> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    return { status: response.status, text: await response.text() };
  } finally {
    clearTimeout(timer);
  }
}

async function readWithRetry(url: string, init: RequestInit): Promise<Answer> {
  for (let attempt = 1; ; attempt += 1) {
    const last = attempt >= READ_ATTEMPTS;
    try {
      const answer = await readOnce(url, init);
      if (last || !isRetryableStatus(answer.status)) return answer;
    } catch (error) {
      if (last) {
        network.unstable = true;
        throw new ApiError(0, 'NETWORK_UNSTABLE', { reason: error instanceof Error ? error.name : 'unknown' });
      }
    }
    await new Promise((done) => setTimeout(done, RETRY_AFTER_MS[attempt - 1] ?? 2_000));
  }
}

/** Reads of the same address while one is still out share it, so a page polling a slow server does not pile them up. */
const reading = new Map<string, Promise<Answer>>();

function read(url: string, init: RequestInit, token: string | null): Promise<Answer> {
  const key = `${token ?? ''} ${url}`;
  let pending = reading.get(key);
  if (!pending) {
    pending = readWithRetry(url, init).finally(() => reading.delete(key));
    reading.set(key, pending);
  }
  return pending;
}

async function sendOnce(url: string, init: RequestInit): Promise<Answer> {
  const response = await fetch(url, init);
  return { status: response.status, text: await response.text() };
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = storedToken();
  const url = `/api${path}`;
  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const answer = method === 'GET' ? await read(url, init, token) : await sendOnce(url, init);
  network.unstable = false;
  if (answer.status === 204) return undefined as T;
  // Each caller gets its own copy, even of a shared read.
  let data: Record<string, unknown> & { code?: string } = {};
  try {
    data = answer.text ? JSON.parse(answer.text) : {};
  } catch {
    // Not JSON: an error page from the front end.
  }
  if (answer.status < 200 || answer.status >= 300) {
    if (answer.status === 401 && token) rememberToken(null);
    throw new ApiError(answer.status, data.code ?? 'UNKNOWN', data);
  }
  return data as T;
}

/**
 * A request whose body or answer is not JSON (a picture, a video). Adds the
 * sign-in token like `api` and fails with the same ApiError.
 */
export async function apiFetch(method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit } = {}) {
  const token = storedToken();
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), ...init.headers },
    body: init.body,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new ApiError(response.status, data.code ?? 'UNKNOWN', data);
  }
  return response;
}

/** Message for any error, in the chosen language. */
export const errorText = (error: unknown) => t(error instanceof Error ? error.message : String(error));

let checking: Promise<void> | null = null;

/** Finds out once who is signed in; calls made while it is being found out share it. */
export function ensureSession(): Promise<void> {
  if (session.checked) return Promise.resolve();
  checking ??= loadSession().finally(() => {
    checking = null;
  });
  return checking;
}

export async function loadSession() {
  try {
    const me = await api<{ user: User; profile: Profile | null }>('GET', '/me');
    session.user = me.user;
    session.profile = me.profile;
    adoptAccountLanguage(me.user.locale);
  } catch {
    session.user = null;
    session.profile = null;
  }
  session.checked = true;
}

export async function signOut() {
  await api('POST', '/auth/logout').catch(() => undefined);
  rememberToken(null);
  session.user = null;
  session.profile = null;
}
