import type { Fetch } from './sms253';

/**
 * Spug 推送助手 (push.spug.cc): verification-code SMS sent through its /sms API, under
 * Spug's own registered signature and one of its official templates, so no company of
 * ours is registered with the carriers. Choosing an official SMS template in its console
 * gives a URL ending in a template code; whoever has that code can send, so it is kept
 * like a password. (Its /send API goes only to recipients bound to the template.)
 */
export const SPUG_DEFAULT_ENDPOINT = 'https://push.spug.cc';

/**
 * The template code, from the code itself or from the whole /sms URL copied out of the
 * Spug console. A /send URL (a notification template) is left whole, so it fails the check.
 */
export function spugTemplateCode(pasted: string): string {
  const value = pasted.trim();
  const fromUrl = /\/sms\/([A-Za-z0-9_-]+)/.exec(value);
  return fromUrl ? fromUrl[1] : value;
}

export const isSpugTemplateCode = (value: string) => /^[A-Za-z0-9_-]{6,80}$/.test(value);

/** Minutes a sign-in code stays valid (the auth service's 10 minutes), for templates that show it. */
export const SPUG_CODE_MINUTES = '10';

/**
 * Sends one verification code to `to`. `number` is the validity in minutes, required by
 * the templates that state it. Spug answers `{ code: 200, msg }` when it has accepted the
 * message. The template code is part of the URL and is never logged.
 */
export async function callSpug(
  fetchImpl: Fetch,
  endpoint: string,
  templateCode: string,
  body: { to: string; code: string; number: string },
): Promise<{ code: string; errorMsg: string | null }> {
  const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/sms/${encodeURIComponent(templateCode)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const raw = ((await response.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (!response.ok) return { code: `HTTP_${response.status}`, errorMsg: raw.msg ? String(raw.msg) : `HTTP ${response.status}` };
  const code = raw.code === undefined || raw.code === null ? 'UNKNOWN' : String(raw.code);
  return { code, errorMsg: code === '200' ? null : raw.msg ? String(raw.msg) : null };
}
