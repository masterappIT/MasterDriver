import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { PaymentChannel, PaymentProvider } from '../../generated/prisma';
import { apiError } from '../common/errors';
import { SECRET_BOX, SecretBox } from '../common/secret-box';
import { PrismaService } from '../prisma.service';
import { isPrivateKey, isPublicKey, parseAlipayHkInput, type PaymentEnvironment } from './alipayhk-config';
import { parseStripeConfigInput, testStripeConnection } from './stripe-config';

const ENVIRONMENTS: PaymentEnvironment[] = ['sandbox', 'production'];
const PROVIDERS: PaymentProvider[] = ['STRIPE', 'ALIPAY_HK'];

export function environmentOf(value: string): PaymentEnvironment {
  if (value !== 'sandbox' && value !== 'production') {
    throw apiError(HttpStatus.BAD_REQUEST, 'ENVIRONMENT_INVALID', 'Environment must be sandbox or production');
  }
  return value;
}

/** What the admin may see: whether each secret is set, never the secret itself. */
function view(provider: PaymentProvider, environment: PaymentEnvironment, row: PaymentChannel | undefined) {
  return {
    provider,
    environment,
    saved: Boolean(row),
    enabled: row?.enabled ?? false,
    publishableKey: row?.publishableKey ?? null,
    secretKeyConfigured: Boolean(row?.secretKeyEnc),
    webhookSecretConfigured: Boolean(row?.webhookSecretEnc),
    paymentMethods: row?.paymentMethods ?? [],
    gatewayUrl: row?.gatewayUrl ?? null,
    partner: row?.partner ?? null,
    appId: row?.appId ?? null,
    privateKeyConfigured: Boolean(row?.privateKeyEnc),
    publicKeyConfigured: Boolean(row?.publicKeyEnc),
    notifyUrl: row?.notifyUrl ?? null,
    returnUrl: row?.returnUrl ?? null,
    lastTestedAt: row?.lastTestedAt?.toISOString() ?? null,
    lastTestStatus: row?.lastTestStatus ?? null,
    lastTestMessage: row?.lastTestMessage ?? null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

/**
 * Stripe and AlipayHK settings for subscriptions and credit top-ups. Only the
 * configuration is managed here; online checkout comes in a later step.
 */
@Injectable()
export class PaymentChannelsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
  ) {}

  /** Injected in tests so no request reaches Stripe. */
  fetchImpl: Parameters<typeof testStripeConnection>[2] = fetch as never;

  async list() {
    const rows = await this.prisma.paymentChannel.findMany();
    const find = (provider: PaymentProvider, environment: string) =>
      rows.find((row) => row.provider === provider && row.environment === environment);
    return PROVIDERS.flatMap((provider) => ENVIRONMENTS.map((environment) => view(provider, environment, find(provider, environment))));
  }

  private find(provider: PaymentProvider, environment: PaymentEnvironment) {
    return this.prisma.paymentChannel.findUnique({ where: { provider_environment: { provider, environment } } });
  }

  async saveStripe(environment: PaymentEnvironment, body: Record<string, unknown>, actor: string) {
    const existing = await this.find('STRIPE', environment);
    const parsed = parseStripeConfigInput({ ...body, environment }, Boolean(existing?.secretKeyEnc));
    if ('error' in parsed) throw apiError(HttpStatus.BAD_REQUEST, 'STRIPE_CONFIG_INVALID', parsed.error);
    const { publishableKey, secretKey, webhookSecret, paymentMethods } = parsed.value;
    const data = {
      publishableKey,
      paymentMethods,
      updatedBy: actor,
      ...(webhookSecret ? { webhookSecretEnc: this.box.seal(webhookSecret) } : {}),
      // A new secret key may belong to another Stripe account: the old test result no longer applies.
      ...(secretKey ? { secretKeyEnc: this.box.seal(secretKey), lastTestedAt: null, lastTestStatus: null, lastTestMessage: null } : {}),
    };
    await this.prisma.paymentChannel.upsert({
      where: { provider_environment: { provider: 'STRIPE', environment } },
      create: { provider: 'STRIPE', environment, ...data },
      update: data,
    });
    return this.list();
  }

  /** Reads the Stripe account only; never creates a charge. */
  async testStripe(environment: PaymentEnvironment) {
    const row = await this.find('STRIPE', environment);
    if (!row?.secretKeyEnc) throw apiError(HttpStatus.NOT_FOUND, 'CHANNEL_NOT_SAVED', 'Save the configuration first');
    const result = await testStripeConnection(this.box.open(row.secretKeyEnc), row.paymentMethods as never, this.fetchImpl);
    await this.recordTest(row.id, result.status, result.message);
    return { ...result, channels: await this.list() };
  }

  async saveAlipayHk(environment: PaymentEnvironment, body: Record<string, unknown>, actor: string) {
    const existing = await this.find('ALIPAY_HK', environment);
    const parsed = parseAlipayHkInput(body, { privateKey: Boolean(existing?.privateKeyEnc), publicKey: Boolean(existing?.publicKeyEnc) });
    if ('error' in parsed) throw apiError(HttpStatus.BAD_REQUEST, parsed.error, parsed.error);
    const { privateKey, publicKey, ...rest } = parsed.value;
    const data = {
      ...rest,
      updatedBy: actor,
      ...(privateKey ? { privateKeyEnc: this.box.seal(privateKey) } : {}),
      ...(publicKey ? { publicKeyEnc: this.box.seal(publicKey) } : {}),
      ...(privateKey || publicKey ? { lastTestedAt: null, lastTestStatus: null, lastTestMessage: null } : {}),
    };
    await this.prisma.paymentChannel.upsert({
      where: { provider_environment: { provider: 'ALIPAY_HK', environment } },
      create: { provider: 'ALIPAY_HK', environment, ...data },
      update: data,
    });
    return this.list();
  }

  /** Like Master Travel: checks the saved RSA2 keys can be read; does not call AlipayHK. */
  async testAlipayHk(environment: PaymentEnvironment) {
    const row = await this.find('ALIPAY_HK', environment);
    if (!row?.privateKeyEnc || !row.publicKeyEnc) throw apiError(HttpStatus.NOT_FOUND, 'CHANNEL_NOT_SAVED', 'Save the configuration first');
    const ok = isPrivateKey(this.box.open(row.privateKeyEnc)) && isPublicKey(this.box.open(row.publicKeyEnc));
    const status = ok ? 'success' : 'error';
    const message = ok ? '金鑰格式檢查通過；這項檢查不會呼叫 AlipayHK，未證明可以實際收款。' : '已儲存的金鑰無法讀取，請重新輸入。';
    await this.recordTest(row.id, status, message);
    return { status, message, channels: await this.list() };
  }

  /** At most one environment per provider is used for payments. Enabling needs a passed check. */
  async setEnabled(provider: PaymentProvider, environment: PaymentEnvironment, enabled: boolean, actor: string) {
    const row = await this.find(provider, environment);
    if (!row) throw apiError(HttpStatus.NOT_FOUND, 'CHANNEL_NOT_SAVED', 'Save the configuration first');
    if (enabled && row.lastTestStatus !== 'success' && row.lastTestStatus !== 'warning') {
      throw apiError(HttpStatus.CONFLICT, 'CHANNEL_NOT_TESTED', 'Run the check successfully before enabling');
    }
    await this.prisma.$transaction([
      ...(enabled
        ? [this.prisma.paymentChannel.updateMany({ where: { provider, environment: { not: environment } }, data: { enabled: false } })]
        : []),
      this.prisma.paymentChannel.update({ where: { id: row.id }, data: { enabled, updatedBy: actor } }),
    ]);
    return this.list();
  }

  private recordTest(id: string, status: string, message: string) {
    return this.prisma.paymentChannel.update({
      where: { id },
      data: { lastTestedAt: new Date(), lastTestStatus: status, lastTestMessage: message },
    });
  }
}
