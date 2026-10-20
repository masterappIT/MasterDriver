export interface AppConfig {
  port: number;
  isProduction: boolean;
  publicBaseUrl: string;
  otpPepper: string;
  /** Print sign-in codes to the log instead of sending SMS. Never true in production. */
  devLogOtp: boolean;
  sessionCookieSecure: boolean;
  /** Key for provider secrets stored in the database (base64, 32 bytes). */
  dataEncryptionKey: string;
  /**
   * Where 客服 pictures and videos (and 名片頁 photos) are kept: a private Cloud
   * Storage bucket, or a directory. On Cloud Run only the bucket will do, because
   * an instance's own disk is lost whenever it stops; on a server (deploy/hostkvm)
   * the directory is a persistent disk that is backed up every day.
   */
  supportMediaBucket: string | null;
  supportMediaDir: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const otpPepper = env.OTP_PEPPER ?? '';
  if (isProduction && otpPepper.length < 32) {
    throw new Error('OTP_PEPPER must be set to at least 32 characters in production');
  }
  const dataEncryptionKey = env.DATA_ENCRYPTION_KEY ?? '';
  if (isProduction && Buffer.from(dataEncryptionKey, 'base64').length !== 32) {
    throw new Error('DATA_ENCRYPTION_KEY must be a base64-encoded 32-byte key in production');
  }
  return {
    port: Number(env.PORT ?? 3020),
    isProduction,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:5180').replace(/\/+$/, ''),
    otpPepper: otpPepper || 'local-development-pepper',
    devLogOtp: !isProduction && env.DEV_LOG_OTP === 'true',
    sessionCookieSecure: env.SESSION_COOKIE_SECURE === 'true',
    dataEncryptionKey: dataEncryptionKey || 'local-development-only-key',
    supportMediaBucket: env.SUPPORT_MEDIA_BUCKET?.trim() || null,
    supportMediaDir: env.SUPPORT_MEDIA_DIR?.trim() || null,
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
