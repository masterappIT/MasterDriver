import { createPrivateKey, createPublicKey } from 'node:crypto';

export type PaymentEnvironment = 'sandbox' | 'production';

export interface AlipayHkInput {
  gatewayUrl: string;
  partner: string;
  appId: string | null;
  privateKey: string;
  publicKey: string;
  notifyUrl: string | null;
  returnUrl: string | null;
}

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

/**
 * Same rules as Master Travel's AlipayHK settings: HTTPS gateway, a 16-digit
 * partner id starting with 2160, RSA2 keys (PKCS8 private, SPKI public). A blank
 * key keeps the stored one; a new configuration needs both.
 */
export function parseAlipayHkInput(
  body: Record<string, unknown>,
  stored: { privateKey: boolean; publicKey: boolean },
): { value: AlipayHkInput } | { error: string } {
  const gatewayUrl = text(body.gatewayUrl);
  const partner = text(body.partner);
  if (!/^https:\/\/\S+$/i.test(gatewayUrl)) return { error: 'ALIPAYHK_GATEWAY_HTTPS' };
  if (!/^2160\d{12}$/.test(partner)) return { error: 'ALIPAYHK_PARTNER_FORMAT' };
  const privateKey = text(body.privateKey);
  const publicKey = text(body.publicKey);
  if ((!privateKey && !stored.privateKey) || (!publicKey && !stored.publicKey)) return { error: 'ALIPAYHK_KEYS_REQUIRED' };
  if (privateKey && !isPrivateKey(privateKey)) return { error: 'ALIPAYHK_PRIVATE_KEY_FORMAT' };
  if (publicKey && !isPublicKey(publicKey)) return { error: 'ALIPAYHK_PUBLIC_KEY_FORMAT' };
  for (const url of [text(body.notifyUrl), text(body.returnUrl)]) {
    if (url && !/^https:\/\/\S+$/i.test(url)) return { error: 'ALIPAYHK_CALLBACK_HTTPS' };
  }
  return {
    value: {
      gatewayUrl,
      partner,
      appId: text(body.appId) || null,
      privateKey,
      publicKey,
      notifyUrl: text(body.notifyUrl) || null,
      returnUrl: text(body.returnUrl) || null,
    },
  };
}

export function isPrivateKey(pem: string) {
  try {
    createPrivateKey({ key: pem, format: 'pem', type: 'pkcs8' });
    return true;
  } catch {
    return false;
  }
}

export function isPublicKey(pem: string) {
  try {
    createPublicKey({ key: pem, format: 'pem', type: 'spki' });
    return true;
  } catch {
    return false;
  }
}
