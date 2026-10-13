import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const VERSION = 'v1';

/**
 * Encrypts provider secrets (payment keys, SMS passwords) before they are
 * stored, the same AES-256-GCM approach Master Travel uses. The 32-byte key
 * comes from DATA_ENCRYPTION_KEY; in production it is injected from Secret
 * Manager. Ciphertext is "v1.<iv>.<tag>.<data>" in base64url.
 */
export class SecretBox {
  private readonly key: Buffer;

  constructor(encodedKey: string) {
    const key = Buffer.from(encodedKey, 'base64');
    // Accept a passphrase too, but only a real 32-byte key is recommended.
    this.key = key.length === 32 ? key : createHash('sha256').update(encodedKey).digest();
  }

  seal(plain: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    return [VERSION, iv, cipher.getAuthTag(), data].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
  }

  open(sealed: string): string {
    const [version, iv, tag, data] = sealed.split('.');
    if (version !== VERSION || !iv || !tag || !data) throw new Error('Unsupported or damaged secret');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  }
}

export const SECRET_BOX = Symbol('SECRET_BOX');
