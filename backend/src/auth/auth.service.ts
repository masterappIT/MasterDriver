import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { defaultLocaleFor, type OtpRequest, type OtpVerify } from '@masterdriver/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { readLimits } from '../common/limits';
import { apiError } from '../common/errors';
import { hmac, randomSixDigits, randomToken, safeEqualHex, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma.service';
import { DevelopmentLoginService, developmentCodeHash } from './development-login.service';
import { SMS_PROVIDER, type SmsProvider } from './sms';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
export const SESSION_TTL_MS = 180 * 24 * 60 * 60 * 1000;
const LAST_SEEN_REFRESH_MS = 60 * 60 * 1000;

export interface SessionUser {
  id: string;
  countryCode: string;
  phone: string;
  locale: string;
  sessionId: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SMS_PROVIDER) private readonly sms: SmsProvider,
    @Inject(DevelopmentLoginService) private readonly developmentLogin: DevelopmentLoginService,
  ) {}

  private codeHash(countryCode: string, phone: string, code: string) {
    return hmac(this.config.otpPepper, `${countryCode}:${phone}:${code}`);
  }

  /**
   * How often a code may be asked for is set in 防濫用設定 and applies in development mode too:
   * it guards the SMS bill and the sign-in itself.
   */
  async requestCode(input: OtpRequest, ip: string | undefined, now = new Date()) {
    const { countryCode, phone } = input;
    const limits = await readLimits(this.prisma);
    const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    const latest = await this.prisma.verificationCode.findFirst({
      where: { countryCode, phone },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true },
    });
    if (latest) {
      const waitSeconds = Math.ceil((latest.createdAt.getTime() + limits.otpResendSeconds * 1000 - now.getTime()) / 1000);
      if (waitSeconds > 0) {
        throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_TOO_FREQUENT', 'Wait before requesting another code', {
          retryAfterSeconds: waitSeconds,
        });
      }
    }
    const [phoneCount, ipCount] = await Promise.all([
      this.prisma.verificationCode.count({ where: { countryCode, phone, createdAt: { gt: hourAgo } } }),
      ip ? this.prisma.verificationCode.count({ where: { ip, createdAt: { gt: hourAgo } } }) : Promise.resolve(0),
    ]);
    if (phoneCount >= limits.otpPerPhonePerHour || ipCount >= limits.otpPerIpPerHour) {
      throw apiError(HttpStatus.TOO_MANY_REQUESTS, 'OTP_LIMIT_REACHED', 'Too many codes requested');
    }

    const expiresAt = new Date(now.getTime() + CODE_TTL_MS);
    // Development mode is decided now and stored on this request: no SMS is sent
    // and the configured code's hash is saved, so later setting changes do not
    // affect codes already issued.
    const development = await this.developmentLogin.forNewRequest();
    if (development.enabled) {
      await this.prisma.verificationCode.create({
        data: { countryCode, phone, ip, mode: 'DEVELOPMENT', codeHash: development.codeHash, expiresAt },
      });
      return { resendAfterSeconds: limits.otpResendSeconds };
    }

    const code = randomSixDigits();
    await this.prisma.verificationCode.create({
      data: { countryCode, phone, ip, mode: 'SMS', codeHash: this.codeHash(countryCode, phone, code), expiresAt },
    });
    await this.sms.sendVerificationCode(countryCode, phone, code);
    return { resendAfterSeconds: limits.otpResendSeconds };
  }

  async verifyCode(input: OtpVerify, userAgent: string | undefined, now = new Date()) {
    const { countryCode, phone, code } = input;
    const record = await this.prisma.verificationCode.findFirst({
      where: { countryCode, phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
    });
    if (!record) throw apiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Code is wrong or expired');
    if (record.attempts >= MAX_ATTEMPTS) throw apiError(HttpStatus.BAD_REQUEST, 'OTP_LOCKED', 'Too many wrong attempts');

    const expected =
      record.mode === 'DEVELOPMENT'
        ? developmentCodeHash(this.config.otpPepper, code)
        : this.codeHash(countryCode, phone, code);
    if (!safeEqualHex(record.codeHash, expected)) {
      await this.prisma.verificationCode.update({ where: { id: record.id }, data: { attempts: { increment: 1 } } });
      throw apiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Code is wrong or expired');
    }
    // Consume once: a code that is verified twice in parallel only signs in once.
    const consumed = await this.prisma.verificationCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw apiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Code is wrong or expired');

    const user = await this.prisma.user.upsert({
      where: { countryCode_phone: { countryCode, phone } },
      update: {},
      create: { countryCode, phone, locale: defaultLocaleFor(countryCode) },
    });
    // 停用: the code was right, but the platform has stopped this account. The same in development mode.
    if (user.suspendedAt) throw apiError(HttpStatus.FORBIDDEN, 'ACCOUNT_SUSPENDED', 'This account has been suspended');
    const token = randomToken();
    await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: sha256(token),
        userAgent: userAgent?.slice(0, 300),
        expiresAt: new Date(now.getTime() + SESSION_TTL_MS),
      },
    });
    return { token, user: { id: user.id, countryCode: user.countryCode, phone: user.phone, locale: user.locale } };
  }

  async resolveSession(token: string, now = new Date()): Promise<SessionUser | null> {
    const session = await this.prisma.session.findUnique({
      where: { tokenHash: sha256(token) },
      include: { user: true },
    });
    if (!session || session.revokedAt || session.expiresAt <= now || session.user.suspendedAt) return null;
    if (now.getTime() - session.lastSeenAt.getTime() > LAST_SEEN_REFRESH_MS) {
      await this.prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
    }
    const { user } = session;
    return { id: user.id, countryCode: user.countryCode, phone: user.phone, locale: user.locale, sessionId: session.id };
  }

  async revokeSession(sessionId: string, now = new Date()) {
    await this.prisma.session.updateMany({ where: { id: sessionId, revokedAt: null }, data: { revokedAt: now } });
  }
}
