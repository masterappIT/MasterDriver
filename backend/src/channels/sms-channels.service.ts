import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { SmsChannelUpdate, SpugSettingUpdate } from '@masterdriver/shared';
import type { SmsChannel, SmsProviderKind, SmsRoute, SpugSetting } from '../../generated/prisma';
import type { SmsProvider } from '../auth/sms';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomSixDigits } from '../common/crypto';
import { apiError } from '../common/errors';
import { SECRET_BOX, SecretBox } from '../common/secret-box';
import { telemetry } from '../observability/telemetry';
import { PrismaService } from '../prisma.service';
import { call253, destinationFor, routeFor, SMS253_DEFAULT_ENDPOINT, SMS253_DEFAULT_TEMPLATE, type Fetch } from './sms253';
import { callSpug, isSpugTemplateCode, SPUG_CODE_MINUTES, SPUG_DEFAULT_ENDPOINT, spugTemplateCode } from './spug';

const ROUTES: SmsRoute[] = ['DOMESTIC', 'INTERNATIONAL'];

function view(row: SmsChannel) {
  return {
    route: row.route,
    provider: row.provider,
    enabled: row.enabled,
    endpoint: row.endpoint,
    account: row.account,
    passwordConfigured: Boolean(row.passwordEnc),
    template: row.template,
    testPhone: row.testPhone,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

function spugView(row: SpugSetting) {
  return {
    enabled: row.enabled,
    endpoint: row.endpoint,
    templateConfigured: Boolean(row.templateCodeEnc),
    testPhone: row.testPhone,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row.lastTestStatus,
    lastTestMessage: row.lastTestMessage,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}

export function routeOf(value: string): SmsRoute {
  if (value !== 'DOMESTIC' && value !== 'INTERNATIONAL') throw apiError(HttpStatus.NOT_FOUND, 'SMS_ROUTE_NOT_FOUND', 'Unknown SMS route');
  return value;
}

/**
 * The SMS channels: one route for +86 and one for +852 and +853, each with its own 253 雲通訊
 * account (as Master Travel does), and one Spug 推送助手 setting for both. Each route chooses
 * which of the two sends its codes; the settings of the other stay as they are. Also the SMS
 * provider behind sign-in codes; development-mode sign-in never reaches it.
 */
@Injectable()
export class SmsChannelsService implements SmsProvider {
  private readonly logger = new Logger('SMS');
  /** Injected in tests so no request reaches 253. */
  fetchImpl: Fetch = fetch as unknown as Fetch;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  private channel(route: SmsRoute) {
    return this.prisma.smsChannel.upsert({
      where: { route },
      update: {},
      // Like Master Travel, only the domestic account has a default endpoint; the international one is entered by hand.
      create: { route, endpoint: route === 'DOMESTIC' ? SMS253_DEFAULT_ENDPOINT : '', template: SMS253_DEFAULT_TEMPLATE },
    });
  }

  async list() {
    return (await Promise.all(ROUTES.map((route) => this.channel(route)))).map(view);
  }

  /** The route's provider choice and its 253 account. Choosing a provider changes no settings. */
  async save(route: SmsRoute, input: SmsChannelUpdate, actor: string) {
    const current = await this.channel(route);
    const { password, ...rest } = input;
    const endpoint = input.endpoint ?? current.endpoint;
    const account = input.account ?? current.account;
    const enabled = input.enabled ?? current.enabled;
    if (enabled && !(account !== '' && endpoint !== '' && (password || current.passwordEnc))) {
      throw apiError(HttpStatus.CONFLICT, 'SMS_ACCOUNT_REQUIRED', 'Enter the account and password before enabling');
    }
    await this.prisma.smsChannel.update({
      where: { route },
      data: {
        ...rest,
        endpoint,
        account,
        enabled,
        updatedBy: actor,
        ...(password ? { passwordEnc: this.box.seal(password), lastTestedAt: null, lastTestStatus: null, lastTestMessage: null } : {}),
      },
    });
    return this.list();
  }

  // ------------------------------------------------------------- Spug 推送助手

  private spugRow() {
    return this.prisma.spugSetting.upsert({ where: { id: 'default' }, update: {}, create: { id: 'default', endpoint: SPUG_DEFAULT_ENDPOINT } });
  }

  async spug() {
    return spugView(await this.spugRow());
  }

  async saveSpug(input: SpugSettingUpdate, actor: string) {
    const current = await this.spugRow();
    const { templateCode: typed, ...rest } = input;
    const templateCode = typed ? spugTemplateCode(typed) : '';
    if (templateCode && !isSpugTemplateCode(templateCode)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'SPUG_TEMPLATE_CODE_INVALID', 'Paste the template URL or code from the Spug console');
    }
    const enabled = input.enabled ?? current.enabled;
    const endpoint = input.endpoint ?? current.endpoint;
    if (enabled && !(endpoint !== '' && (templateCode || current.templateCodeEnc))) {
      throw apiError(HttpStatus.CONFLICT, 'SPUG_TEMPLATE_REQUIRED', 'Enter the endpoint and the SMS template before enabling');
    }
    await this.prisma.spugSetting.update({
      where: { id: 'default' },
      data: {
        ...rest,
        endpoint,
        enabled,
        updatedBy: actor,
        ...(templateCode
          ? { templateCodeEnc: this.box.seal(templateCode), lastTestedAt: null, lastTestStatus: null, lastTestMessage: null }
          : {}),
      },
    });
    return this.spug();
  }

  /** Sends one real SMS through Spug (it costs money); Spug has no check that sends nothing. */
  async testSpug(phone?: string) {
    const row = await this.spugRow();
    const target = (phone ?? row.testPhone).replace(/\D/g, '');
    if (!target) throw apiError(HttpStatus.BAD_REQUEST, 'SMS_TEST_PHONE_REQUIRED', 'Enter a test phone number');
    const { route, countryCode, local } = splitTestNumber(target);
    const result = await this.sendSpug(row, route, countryCode, local, randomSixDigits(), 'TEST');
    const message = result.status === 'sent' ? '測試簡訊已送出' : `發送失敗：${result.providerError ?? result.providerCode ?? result.status}`;
    await this.prisma.spugSetting.update({
      where: { id: 'default' },
      data: { lastTestedAt: new Date(), lastTestStatus: result.status === 'sent' ? 'success' : 'error', lastTestMessage: message },
    });
    return { ...result, spug: await this.spug() };
  }

  private credentials(row: SmsChannel) {
    if (!row.endpoint || !row.account || !row.passwordEnc) return null;
    return { account: row.account, password: this.box.open(row.passwordEnc) };
  }

  /** Queries the account balance: proves the endpoint and credentials without sending anything. */
  async testConnection(route: SmsRoute) {
    const row = await this.channel(route);
    const credentials = this.credentials(row);
    if (!credentials) throw apiError(HttpStatus.CONFLICT, 'SMS_ACCOUNT_REQUIRED', 'Enter the account and password first');
    let status = 'error';
    let message: string;
    try {
      const result = await call253(this.fetchImpl, row.endpoint, '/msg/balance/json', credentials, {});
      if (result.code === '0') {
        status = 'success';
        const balance = result.raw.balance ?? result.raw.money;
        message = `連線正常${balance === undefined ? '' : `，餘額：${String(balance)}`}`;
      } else {
        message = `253 回應錯誤（${result.code}）${result.errorMsg ? `：${result.errorMsg}` : ''}`;
      }
    } catch {
      message = '無法連線 253 短信接口';
    }
    await this.prisma.smsChannel.update({ where: { route }, data: { lastTestedAt: new Date(), lastTestStatus: status, lastTestMessage: message } });
    return { status, message, channels: await this.list() };
  }

  /** Sends one real SMS through the route's 253 account (it costs money) with a code shown nowhere. */
  async testSend(route: SmsRoute, phone?: string) {
    const row = await this.channel(route);
    const target = (phone ?? row.testPhone).replace(/\D/g, '');
    if (!target) throw apiError(HttpStatus.BAD_REQUEST, 'SMS_TEST_PHONE_REQUIRED', 'Enter a test phone number');
    const countryCode = route === 'DOMESTIC' ? '+86' : target.startsWith('853') ? '+853' : '+852';
    // The test number is entered with its country code; strip it for the 253 request.
    const local = route === 'DOMESTIC' ? target.replace(/^86(?=1\d{10}$)/, '') : target.replace(/^(852|853)/, '');
    return this.send253(row, countryCode, local, randomSixDigits(), 'TEST');
  }

  async messages() {
    const rows = await this.prisma.smsMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  /** SmsProvider: sign-in codes, through the provider the number's route chose. */
  async sendVerificationCode(countryCode: string, phone: string, code: string) {
    const row = await this.channel(routeFor(countryCode));
    const spug = row.provider === 'SPUG' ? await this.spugRow() : null;
    const ready = spug ? spug.enabled && Boolean(spug.endpoint && spug.templateCodeEnc) : row.enabled && Boolean(this.credentials(row));
    if (!ready) {
      if (this.config.devLogOtp) {
        this.logger.warn(`[development] verification code for ${countryCode} ${phone}: ${code}`);
        return;
      }
      throw apiError(HttpStatus.SERVICE_UNAVAILABLE, 'SMS_NOT_CONFIGURED', 'SMS is not configured for this number');
    }
    const result = spug ? await this.sendSpug(spug, row.route, countryCode, phone, code, 'OTP') : await this.send253(row, countryCode, phone, code, 'OTP');
    if (result.status !== 'sent') throw apiError(HttpStatus.BAD_GATEWAY, 'SMS_SEND_FAILED', 'The SMS could not be sent; try again');
  }

  private async send253(row: SmsChannel, countryCode: string, phone: string, code: string, purpose: 'OTP' | 'TEST') {
    const credentials = this.credentials(row);
    if (!credentials) throw apiError(HttpStatus.CONFLICT, 'SMS_ACCOUNT_REQUIRED', 'Enter the account and password first');
    const message = (row.template || SMS253_DEFAULT_TEMPLATE).replace('{code}', code);
    return this.attempt(row.route, 'SMS253', countryCode, phone, purpose, async () => {
      const result = await call253(this.fetchImpl, row.endpoint, '/msg/send/json', credentials, {
        phone: destinationFor(row.route, countryCode, phone),
        msg: message,
        report: 'false',
      });
      return { code: result.code, errorMsg: result.errorMsg, sent: result.code === '0' };
    });
  }

  private async sendSpug(row: SpugSetting, route: SmsRoute, countryCode: string, phone: string, code: string, purpose: 'OTP' | 'TEST') {
    if (!row.endpoint || !row.templateCodeEnc) {
      throw apiError(HttpStatus.CONFLICT, 'SPUG_TEMPLATE_REQUIRED', 'Enter the endpoint and the SMS template first');
    }
    const templateCode = this.box.open(row.templateCodeEnc);
    return this.attempt(route, 'SPUG', countryCode, phone, purpose, async () => {
      // Spug's official template carries the text; we give the number, the code and how long it lasts.
      const result = await callSpug(this.fetchImpl, row.endpoint, templateCode, { to: destinationFor(route, countryCode, phone), code, number: SPUG_CODE_MINUTES });
      return { code: result.code, errorMsg: result.errorMsg, sent: result.code === '200' };
    });
  }

  /** One attempt, recorded by its outcome only: the message text contains the code. */
  private async attempt(
    route: SmsRoute,
    provider: SmsProviderKind,
    countryCode: string,
    phone: string,
    purpose: 'OTP' | 'TEST',
    call: () => Promise<{ code: string; errorMsg: string | null; sent: boolean }>,
  ) {
    let status = 'failed';
    let providerCode: string | null = null;
    let providerError: string | null = null;
    try {
      const result = await call();
      providerCode = result.code;
      providerError = result.errorMsg;
      status = result.sent ? 'sent' : 'rejected';
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
    }
    await this.prisma.smsMessage.create({ data: { route, provider, countryCode, phone, purpose, status, providerCode, providerError } });
    telemetry.domain(`sms.${provider.toLowerCase()}`, status === 'sent' ? 'success' : 'error');
    return { status, providerCode, providerError };
  }
}

/** A test number typed with its country code: which route it belongs to, and the local part. */
function splitTestNumber(digits: string) {
  if (/^86(1\d{10})$/.test(digits) || /^1\d{10}$/.test(digits)) {
    return { route: 'DOMESTIC' as const, countryCode: '+86', local: digits.replace(/^86/, '') };
  }
  const countryCode = digits.startsWith('853') ? '+853' : '+852';
  return { route: 'INTERNATIONAL' as const, countryCode, local: digits.replace(/^(852|853)/, '') };
}
