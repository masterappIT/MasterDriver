import { reactive } from 'vue';

export type AdminRole = 'SUPER_ADMIN' | 'OPERATOR' | 'SALES';

export interface AdminAccount {
  id: string;
  username: string;
  displayName: string;
  role: AdminRole;
}

export const session = reactive<{ admin: AdminAccount | null; checked: boolean }>({ admin: null, checked: false });

/** User-facing text for the API's stable error codes. */
const ERROR_TEXT: Record<string, string> = {
  ADMIN_LOGIN_INVALID: '帳號或密碼錯誤',
  ADMIN_LOGIN_LOCKED: '登入失敗次數太多，請 15 分鐘後再試',
  ADMIN_SIGN_IN_REQUIRED: '請重新登入',
  ADMIN_ROLE_FORBIDDEN: '你的角色沒有這個權限',
  ADMIN_PASSWORD_WRONG: '目前密碼不正確',
  ADMIN_USERNAME_TAKEN: '這個帳號名稱已被使用',
  ADMIN_CANNOT_DISABLE_SELF: '不能停用自己的帳號',
  VALIDATION_FAILED: '輸入的資料不正確，請檢查後再試',
  BALANCE_WOULD_BE_NEGATIVE: '調整後點數會變成負數',
  TOPUP_MUST_BE_POSITIVE: '充值金額必須大於 0',
  USER_NOT_FOUND: '找不到這個用戶',
  USER_ALREADY_SUSPENDED: '這個帳號已經停用',
  USER_NOT_SUSPENDED: '這個帳號沒有被停用',
  INVALID_ORDER_STATUS: '這張單已經完成或取消，不能再取消',
  ORDER_NOT_FOUND: '找不到這張單',
  PLAN_NOT_FOUND: '找不到這個方案',
  FEATURE_NOT_FOUND: '找不到這個功能',
  AD_NOT_FOUND: '找不到這則廣告',
  SEO_PAGE_NOT_FOUND: '找不到這個頁面設定',
  STRIPE_CONFIG_INVALID: 'Stripe 設定不正確：請確認金鑰和環境相符（測試用 pk_test／sk_test，正式用 pk_live／sk_live），並至少選一種付款方式',
  ALIPAYHK_GATEWAY_HTTPS: '支付網關必須以 https:// 開頭',
  ALIPAYHK_PARTNER_FORMAT: '商戶 ID 必須是 2160 開頭的 16 位數字',
  ALIPAYHK_KEYS_REQUIRED: '第一次設定必須填寫私鑰和公鑰',
  ALIPAYHK_PRIVATE_KEY_FORMAT: '私鑰格式不正確（需要 PKCS8 PEM）',
  ALIPAYHK_PUBLIC_KEY_FORMAT: '公鑰格式不正確（需要 SPKI PEM）',
  ALIPAYHK_CALLBACK_HTTPS: '通知和返回地址必須以 https:// 開頭',
  CHANNEL_NOT_SAVED: '請先儲存設定',
  CHANNEL_NOT_TESTED: '請先通過檢查再啟用',
  SMS_ACCOUNT_REQUIRED: '請先填寫接口網址、帳號和密碼',
  SPUG_TEMPLATE_CODE_INVALID: '請貼上 Spug 後台的範本調用網址，或網址最後那段編碼',
  SMS_TEST_PHONE_REQUIRED: '請先填寫測試號碼',
  LOGO_IMAGE_INVALID: 'Logo 必須是 400 KB 以內的 PNG、JPG 或 WebP 圖片',
  SUPPORT_CONVERSATION_NOT_FOUND: '找不到這個對話',
  SUPPORT_MEDIA_TYPE: '只能傳送圖片（PNG、JPG、WebP）或影片（MP4、MOV、WebM）',
  SUPPORT_MEDIA_TOO_LARGE: '檔案太大：圖片上限 5 MB，影片上限 25 MB',
  SUPPORT_MEDIA_UNAVAILABLE: '尚未設定媒體儲存空間，暫時只能傳送文字',
  SUPPORT_MEDIA_NOT_FOUND: '檔案已過期或不存在',
};

/** Field-level reasons the API gives for VALIDATION_FAILED. */
const ISSUE_TEXT: Record<string, string> = {
  HTTPS_URL_REQUIRED: '連結必須以 https:// 開頭',
  PLAIN_TOKEN_REQUIRED: '驗證碼和統計 ID 只能填代碼本身，不要貼整段程式碼',
  NO_TRAILING_SLASH: '正式網域結尾不要加 /',
  LINK_REQUIRED: '請填寫連結',
  NOTHING_TO_UPDATE: '沒有要更新的內容',
  TEMPLATE_NEEDS_CODE: '簡訊範本必須包含 {code}',
  PLATE_REQUIRED: '這個車牌類型要填的車牌還沒填齊',
  PLATE_TYPE_NOT_ALLOWED: '中國內地的車只有兩地牌',
  HK_PLATE_INVALID: '香港車牌格式不正確',
  MACAU_PLATE_INVALID: '澳門車牌格式必須為 AA-00-00',
  MAINLAND_PLATE_INVALID: '內地車牌格式不正確，要寫完整，例如 粵Z·1234港',
  HK_MACAU_PHONE_INVALID: '港澳號碼格式不正確：要含 +852 或 +853',
  MAINLAND_PHONE_INVALID: '內地號碼格式不正確：要含 +86',
  DIGITS_ONLY: '測試號碼只能填數字',
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    issues: { message: string }[] = [],
  ) {
    const reasons = [...new Set(issues.map((issue) => ISSUE_TEXT[issue.message]).filter(Boolean))];
    super(reasons.length > 0 ? reasons.join('；') : (ERROR_TEXT[code] ?? `操作失敗（${code}）`));
  }
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/admin${path}`, {
    method,
    credentials: 'same-origin',
    headers: {
      // Required by the API on every admin request; a cross-site form cannot send it.
      'x-md-admin': '1',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) session.admin = null;
    throw new ApiError(response.status, data.code ?? 'UNKNOWN', data.issues);
  }
  return data as T;
}

/** A request whose body or answer is not JSON (客服 pictures and videos). */
export async function apiFetch(method: string, path: string, init: { headers?: Record<string, string>; body?: BodyInit } = {}) {
  const response = await fetch(`/api/admin${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'x-md-admin': '1', ...init.headers },
    body: init.body,
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    if (response.status === 401) session.admin = null;
    throw new ApiError(response.status, data.code ?? 'UNKNOWN', data.issues);
  }
  return response;
}

export const can = {
  write: () => session.admin?.role === 'SUPER_ADMIN' || session.admin?.role === 'OPERATOR',
  superAdmin: () => session.admin?.role === 'SUPER_ADMIN',
};

export const ROLE_LABEL: Record<AdminRole, string> = {
  SUPER_ADMIN: '超級管理員',
  OPERATOR: '營運',
  SALES: '銷售',
};
