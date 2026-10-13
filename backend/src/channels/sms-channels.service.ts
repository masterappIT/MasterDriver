import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { SmsChannelUpdate } from '@masterdriver/shared';
import type { SmsChannel, SmsRoute } from '../../generated/prisma';
import type { SmsProvider } from '../auth/sms';
import { APP_CONFIG, type AppConfig } from '../config';
import { randomSixDigits } from '../common/crypto';
import { apiError } from '../common/errors';
import { SECRET_BOX, SecretBox } from '../common/secret-box';
import { telemetry } from '../observability/telemetry';
import { PrismaService } from '../prisma.service';
import { call253, destinationFor, routeFor, SMS253_DEFAULT_ENDPOINT, SMS253_DEFAULT_TEMPLATE, type Fetch } from './sms253';
import { callSpug, isSpugTemplateCode, SPUG_DEFAULT_ENDPOINT, spugTemplateCode } from './spug';

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

export function routeOf(value: string): SmsRoute {
  if (value !== 'DOMESTIC' && value !== 'INTERNATIONAL') throw apiError(HttpStatus.NOT_FOUND, 'SMS_ROUTE_NOT_FOUND', 'Unknown SMS route');
  return value;
}

/**
 * The SMS channels: one for +86 and one for +852 and +853, each sent through 253
 * 雲通訊 (as Master Travel does) or through Spug 推送助手. Also the SMS provider
 * behind sign-in codes; development-mode sign-in never reaches it.
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

  async save(route: SmsRoute, input: SmsChannelUpdate, actor: string) {
    const current = await this.channel(route);
    const { password: typed, ...rest } = input;
    const provider = input.provider ?? current.provider;
    // Another provider's account is of no use to this one: switching starts clean and switched off.
    const switched = provider !== current.provider;
    const password = typed && provider === 'SPUG' ? spugTemplateCode(typed) : typed;
    if (password && provider === 'SPUG' && !isSpugTemplateCode(password)) {
      throw apiError(HttpStatus.BAD_REQUEST, 'SPUG_TEMPLATE_CODE_INVALID', 'Paste the template URL or code from the Spug console');
    }
    const defaultEndpoint = provider === 'SPUG' ? SPUG_DEFAULT_ENDPOINT : route === 'DOMESTIC' ? SMS253_DEFAULT_ENDPOINT : '';
    const endpoint = input.endpoint ?? (switched ? defaultEndpoint : current.endpoint);
    const account = input.account ?? (switched ? '' : current.account);
    const hasSecret = Boolean(password || (!switched && current.passwordEnc));
    const enabled = input.enabled ?? (switched ? false : current.enabled);
    if (enabled && !(account !== '' && endpoint !== '' && hasSecret)) {
      throw apiError(HttpStatus.CONFLICT, 'SMS_ACCOUNT_REQUIRED', 'Enter the account and password before enabling');
    }
    await this.prisma.smsChannel.update({
      where: { route },
      data: {
        ...rest,
        provider,
        endpoint,
        account,
        enabled,
        updatedBy: actor,
        ...(switched ? { passwordEnc: null, lastTestedAt: null, lastTestStatus: null, lastTestMessage: null } : {}),
        ...(password ? { passwordEnc: this.box.seal(password), lastTestedAt: null, lastTestStatus: null, lastTestMessage: null } : {}),
      },
    });
    return this.list();
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
    if (row.provider === 'SPUG') {
      // Spug has no call that proves the template without sending; say so instead of pretending.
      const message = 'Spug 沒有不發簡訊的連線檢查，請用「發送測試簡訊」確認';
      await this.prisma.smsChannel.update({ where: { route }, data: { lastTestedAt: new Date(), lastTestStatus: 'skipped', lastTestMessage: message } });
      return { status: 'skipped', message, channels: await this.list() };
    }
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

  /** Sends one real SMS (it costs money) with a random code that is not shown anywhere. */
  async testSend(route: SmsRoute, phone?: string) {
    const row = await this.channel(route);
    const target = (phone ?? row.testPhone).replace(/\D/g, '');
    if (!target) throw apiError(HttpStatus.BAD_REQUEST, 'SMS_TEST_PHONE_REQUIRED', 'Enter a test phone number');
    const countryCode = route === 'DOMESTIC' ? '+86' : target.startsWith('853') ? '+853' : '+852';
    // The test number is entered with its country code; strip it for the 253 request.
    const local = route === 'DOMESTIC' ? target.replace(/^86(?=1\d{10}$)/, '') : target.replace(/^(852|853)/, '');
    return this.send(row, countryCode, local, randomSixDigits(), 'TEST');
  }

  async messages() {
    const rows = await this.prisma.smsMessage.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
  }

  /** SmsProvider: sign-in codes. */
  async sendVerificationCode(countryCode: string, phone: string, code: string) {
    const row = await this.channel(routeFor(countryCode));
    if (!row.enabled || !this.credentials(row)) {
      if (this.config.devLogOtp) {
        this.logger.warn(`[development] verification code for ${countryCode} ${phone}: ${code}`);
        return;
      }
      throw apiError(HttpStatus.SERVICE_UNAVAILABLE, 'SMS_NOT_CONFIGURED', 'SMS is not configured for this number');
    }
    const result = await this.send(row, countryCode, phone, code, 'OTP');
    if (result.status !== 'sent') throw apiError(HttpStatus.BAD_GATEWAY, 'SMS_SEND_FAILED', 'The SMS could not be sent; try again');
  }

  private async send(row: SmsChannel, countryCode: string, phone: string, code: string, purpose: 'OTP' | 'TEST') {
    const credentials = this.credentials(row);
    if (!credentials) throw apiError(HttpStatus.CONFLICT, 'SMS_ACCOUNT_REQUIRED', 'Enter the account and password first');
    const message = (row.template || SMS253_DEFAULT_TEMPLATE).replace('{code}', code);
    let status = 'failed';
    let providerCode: string | null = null;
    let providerError: string | null = null;
    try {
      if (row.provider === 'SPUG') {
        // Spug's own template carries the text; we give the application name, the code and the number.
        const result = await callSpug(this.fetchImpl, row.endpoint, credentials.password, {
          name: credentials.account,
          code,
          targets: destinationFor(row.route, countryCode, phone),
        });
        providerCode = result.code;
        providerError = result.errorMsg;
        status = result.code === '200' ? 'sent' : 'rejected';
      } else {
        const result = await call253(this.fetchImpl, row.endpoint, '/msg/send/json', credentials, {
          phone: destinationFor(row.route, countryCode, phone),
          msg: message,
          report: 'false',
        });
        providerCode = result.code;
        providerError = result.errorMsg;
        status = result.code === '0' ? 'sent' : 'rejected';
      }
    } catch (error) {
      providerError = error instanceof Error ? error.message : String(error);
    }
    // The message text contains the code, so only the outcome is stored.
    await this.prisma.smsMessage.create({
      data: { route: row.route, provider: row.provider, countryCode, phone, purpose, status, providerCode, providerError },
    });
    telemetry.domain(`sms.${row.provider.toLowerCase()}`, status === 'sent' ? 'success' : 'error');
    return { status, providerCode, providerError };
  }
}
