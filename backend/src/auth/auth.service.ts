import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { COUNTRY_CODES, defaultLocaleFor, type CountryCode, type OtpRequest, type OtpVerify } from '@masterdriver/shared';
import { APP_CONFIG, type AppConfig } from '../config';
import { readLimits } from '../common/limits';
import { apiError } from '../common/errors';
import { hmac, randomSixDigits, randomToken, safeEqualHex, sha256 } from '../common/crypto';
import { PrismaService } from '../prisma.service';
import { DevelopmentLoginService, developmentCodeHash } from './development-login.service';
import { SMS_PROVIDER, type SmsProvider } from './sms';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** How many of a number's newest unused, unexpired codes sign in. */
const LIVE_CODES = 3;
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
    // Refused before anything is stored, so a number whose SMS is not set up is not held to the resend wait.
    if (!development.enabled && !(await this.sms.canSend(countryCode))) {
      throw apiError(HttpStatus.SERVICE_UNAVAILABLE, 'SMS_NOT_CONFIGURED', 'SMS is not configured for this number');
    }
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

  /**
   * Which country codes can sign in now, for the sign-in form to say so before a code is asked
   * for. Development mode sends no SMS, so every one can then.
   */
  async signInAreas(): Promise<{ areas: { countryCode: CountryCode; available: boolean }[] }> {
    const development = await this.developmentLogin.forNewRequest();
    // One at a time: +852 and +853 share a route, whose settings row is created on first read.
    const areas: { countryCode: CountryCode; available: boolean }[] = [];
    for (const countryCode of COUNTRY_CODES) {
      areas.push({ countryCode, available: development.enabled || (await this.sms.canSend(countryCode)) });
    }
    return { areas };
  }

  async verifyCode(input: OtpVerify, userAgent: string | undefined, now = new Date()) {
    const { countryCode, phone, code } = input;
    // The few newest live codes all count: an SMS can take a minute, so the one asked for
    // before 重新發送 may arrive after it. Each is checked by the mode of its own request.
    const records = await this.prisma.verificationCode.findMany({
      where: { countryCode, phone, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      take: LIVE_CODES,
    });
    if (records.length === 0) throw apiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Code is wrong or expired');
    const open = records.filter((record) => record.attempts < MAX_ATTEMPTS);
    if (open.length === 0) throw apiError(HttpStatus.BAD_REQUEST, 'OTP_LOCKED', 'Too many wrong attempts');

    const record = open.find((candidate) => {
      const expected =
        candidate.mode === 'DEVELOPMENT'
          ? developmentCodeHash(this.config.otpPepper, code)
          : this.codeHash(countryCode, phone, code);
      return safeEqualHex(candidate.codeHash, expected);
    });
    if (!record) {
      // A wrong code counts against every code it was tried on, so the limit stays five tries in all.
      await this.prisma.verificationCode.updateMany({
        where: { id: { in: open.map((candidate) => candidate.id) } },
        data: { attempts: { increment: 1 } },
      });
      throw apiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Code is wrong or expired');
    }
    // Consume once: a code that is verified twice in parallel only signs in once.
    const consumed = await this.prisma.verificationCode.updateMany({
      where: { id: record.id, consumedAt: null },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw apiError(HttpStatus.BAD_REQUEST, 'OTP_INVALID', 'Code is wrong or expired');
    // The other codes sent for this sign-in are no longer needed. They expire rather than count
    // as used, so 驗證碼等待時間 sees one sign-in, through the code that was typed.
    await this.prisma.verificationCode.updateMany({
      where: { countryCode, phone, consumedAt: null, expiresAt: { gt: now } },
      data: { expiresAt: now },
    });

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
