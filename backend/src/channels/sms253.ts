import type { SmsRoute } from '../../generated/prisma';

/** 253 雲通訊 defaults, as in Master Travel. */
export const SMS253_DEFAULT_ENDPOINT = 'https://smssh1.253.com';
export const SMS253_DEFAULT_TEMPLATE = '【MasterDriver】您的驗證碼是{code}，10 分鐘內有效。如非本人操作，請忽略。';

/** +86 goes to the domestic account; Hong Kong and Macau numbers to the international one. */
export function routeFor(countryCode: string): SmsRoute {
  return countryCode === '+86' ? 'DOMESTIC' : 'INTERNATIONAL';
}

/**
 * The number as each 253 account expects it: domestic takes the bare 11-digit
 * number; international takes the country code without "+" followed by the
 * number. To be confirmed against the live international account.
 */
export function destinationFor(route: SmsRoute, countryCode: string, phone: string): string {
  return route === 'DOMESTIC' ? phone : `${countryCode.replace('+', '')}${phone}`;
}

export function sms253Url(endpoint: string, path: string): string {
  const base = endpoint.replace(/\/+$/, '').replace(/\/msg\/(?:send|variable|balance)\/json$/i, '');
  return `${base}${path}`;
}

export type Fetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Posts to a 253 endpoint. The account password is sent only in the request body, never logged. */
export async function call253(
  fetchImpl: Fetch,
  endpoint: string,
  path: '/msg/send/json' | '/msg/balance/json',
  credentials: { account: string; password: string },
  body: Record<string, string>,
): Promise<{ code: string; errorMsg: string | null; raw: Record<string, unknown> }> {
  const response = await fetchImpl(sms253Url(endpoint, path), {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify({ ...credentials, ...body }),
    signal: AbortSignal.timeout(10_000),
  });
  const raw = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (!response.ok) return { code: `HTTP_${response.status}`, errorMsg: `HTTP ${response.status}`, raw };
  return {
    code: raw.code === undefined || raw.code === null ? 'UNKNOWN' : String(raw.code),
    errorMsg: raw.errorMsg ? String(raw.errorMsg) : null,
    raw,
  };
}
