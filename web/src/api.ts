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
function storedToken() {
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
  NOT_LAST_LEG: '只能接在行程的最後一段後面，請重新整理',
  JOURNEY_LEG_LIMIT: '一個行程最多 4 段',
  LEG_BEFORE_PREVIOUS: '這一段的時間不能早於上一段',
  PROFILE_PAGE_NOT_FOUND: '找不到這個名片頁，或司機尚未公開',
  BOOKING_NOT_FOUND: '找不到這個預約',
  BOOKING_NOT_OPEN: '這個預約已經結束，不能再更改',
  BOOKING_IN_THE_PAST: '請選擇將來的時間',
  BOOKING_LIMIT: '今天送出的預約太多了，請直接聯絡司機',
  BOOKING_PAGE_FULL: '這位司機今天的預約已滿，請直接聯絡司機或明天再試',
  PHOTO_TYPE: '照片只接受 PNG、JPG 或 WebP',
  PHOTO_TOO_LARGE: '照片太大，上限 5 MB',
  PHOTO_LIMIT: '照片已達上限，請先刪除一張',
  PHOTO_NOT_FOUND: '找不到這張照片',
  SUPPORT_MEDIA_TYPE: '只能傳送圖片（PNG、JPG、WebP）或影片（MP4、MOV、WebM）',
  SUPPORT_MEDIA_TOO_LARGE: '檔案太大：圖片上限 5 MB，影片上限 25 MB',
  SUPPORT_MEDIA_LIMIT: '今天傳送的圖片和影片已達上限，請改用文字',
  SUPPORT_MEDIA_UNAVAILABLE: '暫時無法傳送圖片和影片，請先用文字',
  SUPPORT_MEDIA_NOT_FOUND: '檔案已過期或不存在',
  SUPPORT_VIDEO_SIGN_IN: '登入後才能傳送影片',
  SUPPORT_TOO_FAST: '訊息太頻密，請稍等一下再傳',
  SUPPORT_GUEST_LIMIT: '暫時無法開始新的訪客對話，請登入後再聯絡客服',
  TRANSFER_PLACE_LOCKED: '上一段已有司機接單，接駁位置要和上一段的目的地相同；要改請先改派上一段'
};

const INVALID_PHONE = 'INVALID_PHONE';

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
          : ERROR_TEXT[code];
    super(text ?? `操作失敗（${code}）`);
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const token = storedToken();
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && token) rememberToken(null);
    throw new ApiError(response.status, data.code ?? 'UNKNOWN', data);
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
