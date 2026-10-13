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
  ORDER_NOT_FOUND: '找不到這張單',
  PLAN_NOT_FOUND: '找不到這個方案',
  FEATURE_NOT_FOUND: '找不到這個功能',
};

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(ERROR_TEXT[code] ?? `操作失敗（${code}）`);
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
    throw new ApiError(response.status, data.code ?? 'UNKNOWN');
  }
  return data as T;
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
