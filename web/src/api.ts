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
  hkPlate: string | null;
  macauPlate: string | null;
  mainlandPlate: string | null;
  vehicleType: string | null;
  seats: number | null;
  color: string | null;
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
  CANNOT_CLAIM_OWN_ORDER: '不能搶自己發的單',
  PROFILE_REQUIRED: '請先填寫司機資料',
  TEAM_ONLY: '這張單只限車隊成員搶',
  INVALID_ORDER_STATUS: '這張單的狀態已經改變，請重新整理',
  DRIVER_PRICE_LOCKED: '已有司機接單，司機價不能再改',
  QUOTA_EXCEEDED: '本月發單額度已用完',
  FEATURE_NOT_AVAILABLE: '你目前的方案沒有這個功能',
  INSUFFICIENT_CREDITS: '點數不足，請先充值',
  QR_IMAGE_INVALID: '請上傳 400 KB 以內的 PNG、JPG 或 WebP 圖片',
  GROUP_INVITE_LIMIT: '最多只能加入 5 個群',
  GROUP_INVITE_NOT_FOUND: '找不到這個群',
  NOT_LAST_LEG: '只能接在行程的最後一段後面，請重新整理',
  JOURNEY_LEG_LIMIT: '一個行程最多 4 段',
  LEG_BEFORE_PREVIOUS: '這一段的時間不能早於上一段',
  HANDOFF_WITHOUT_LEG: '交接方式只用於接駁段'
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
