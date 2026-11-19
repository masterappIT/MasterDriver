import { createHmac } from 'node:crypto';

/** How long a credential is good for. The chat trades it for its own token when it first opens, so it need not last. */
export const MASTERBOX_CREDENTIAL_SECONDS = 60 * 60;

export interface MasterBoxKey {
  appId: string;
  signingSecret: string;
}

const encode = (value: object) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');

/**
 * A MasterBox Chat Box 客戶憑證 for a signed-in driver (masterbox-platform docs/api-embedding-guide.md, 共同的部分 4):
 * an HS256 JWT whose kid is the App ID and sub the driver's id, signed with the signing secret. It is worked out here;
 * nothing is sent to MasterBox. The website widget is handed it with MasterBoxChat.setToken, and MasterBox checks it.
 */
export function signMasterBoxCredential(driver: { id: string; name?: string | null }, key: MasterBoxKey, now = new Date()) {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const header = { alg: 'HS256', typ: 'JWT', kid: key.appId };
  const name = driver.name?.trim();
  const claims = { sub: driver.id, ...(name ? { name } : {}), iat: issuedAt, exp: issuedAt + MASTERBOX_CREDENTIAL_SECONDS };
  const signed = `${encode(header)}.${encode(claims)}`;
  return `${signed}.${createHmac('sha256', key.signingSecret).update(signed).digest('base64url')}`;
}
