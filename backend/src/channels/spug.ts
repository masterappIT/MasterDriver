import type { Fetch } from './sms253';

/**
 * Spug 推送助手 (push.spug.cc): verification-code SMS sent under Spug's own
 * registered signature and fixed template, so no company of ours is registered
 * with the carriers. A message template made in its console gives a URL ending
 * in a template code; whoever has that code can send, so it is kept like a password.
 */
export const SPUG_DEFAULT_ENDPOINT = 'https://push.spug.cc';

/** The template code, from the code itself or from the whole URL copied out of the Spug console. */
export function spugTemplateCode(pasted: string): string {
  const value = pasted.trim();
  const fromUrl = /\/send\/([A-Za-z0-9_-]+)/.exec(value);
  return fromUrl ? fromUrl[1] : value;
}

export const isSpugTemplateCode = (value: string) => /^[A-Za-z0-9_-]{6,80}$/.test(value);

/**
 * Sends one verification code. `name` fills the template's application name and
 * `targets` is the phone number. Spug answers `{ code: 200, msg }` when it has
 * accepted the message. The template code is part of the URL and is never logged.
 */
export async function callSpug(
  fetchImpl: Fetch,
  endpoint: string,
  templateCode: string,
  body: { name: string; code: string; targets: string },
): Promise<{ code: string; errorMsg: string | null }> {
  const response = await fetchImpl(`${endpoint.replace(/\/+$/, '')}/send/${encodeURIComponent(templateCode)}`, {
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
