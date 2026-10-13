export interface AppConfig {
  port: number;
  isProduction: boolean;
  publicBaseUrl: string;
  otpPepper: string;
  /** Print sign-in codes to the log instead of sending SMS. Never true in production. */
  devLogOtp: boolean;
  sessionCookieSecure: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const isProduction = env.NODE_ENV === 'production';
  const otpPepper = env.OTP_PEPPER ?? '';
  if (isProduction && otpPepper.length < 32) {
    throw new Error('OTP_PEPPER must be set to at least 32 characters in production');
  }
  return {
    port: Number(env.PORT ?? 3020),
    isProduction,
    publicBaseUrl: (env.PUBLIC_BASE_URL ?? 'http://localhost:5180').replace(/\/+$/, ''),
    otpPepper: otpPepper || 'local-development-pepper',
    devLogOtp: !isProduction && env.DEV_LOG_OTP === 'true',
    sessionCookieSecure: env.SESSION_COOKIE_SECURE === 'true',
  };
}

export const APP_CONFIG = Symbol('APP_CONFIG');
