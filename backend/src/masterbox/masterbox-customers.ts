import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config';
import { PrismaService } from '../prisma.service';

/** MasterBox's API for a company's own server (masterbox-platform backend/openapi/v1.yaml). */
export const MASTERBOX_API = 'https://api.masterbox.masterappinc.com/api/v1';
const TIMEOUT_MS = 10_000;
/** When MasterBox says to slow down (429) without saying how long. */
const RETRY_AFTER_DEFAULT_SECONDS = 5;

/**
 * The 客戶欄位 a driver brings to MasterBox. Each key is defined once in MasterBox's 管理網頁 →
 * 「API 與 Webhook」→ 客戶欄位 before anything is sent; a key it does not know is refused.
 */
export const MASTERBOX_CUSTOMER_FIELDS = {
  hk_plate: '香港車牌',
  macau_plate: '澳門車牌',
  mainland_plate: '內地車牌',
  vehicle_type: '車型',
  hk_macau_phone: '港澳電話',
  mainland_phone: '內地電話',
  admin_url: '後台資料',
} as const;

type FieldKey = keyof typeof MASTERBOX_CUSTOMER_FIELDS;

export interface DriverForMasterBox {
  id: string;
  countryCode: string;
  phone: string;
  locale: string;
  profile: {
    name: string;
    hkPlate: string | null;
    macauPlate: string | null;
    mainlandPlate: string | null;
    vehicleType: string | null;
    hkMacauPhone: string | null;
    mainlandPhone: string | null;
  } | null;
}

const LOCALES = new Set(['zh-Hant', 'zh-Hans', 'en']);
const orNull = (value: string | null | undefined) => value?.trim() || null;

/**
 * What PUT /customers/{id} is sent for a driver: their name, the number they sign in with, 司機, their language, and
 * the 客戶欄位 above. An empty field is sent as null, which takes it off MasterBox. No name before the profile is filled.
 */
export function customerBody(user: DriverForMasterBox, adminBaseUrl: string | null) {
  const profile = user.profile;
  const name = orNull(profile?.name)?.slice(0, 100);
  const attributes: Record<FieldKey, string | null> = {
    hk_plate: orNull(profile?.hkPlate),
    macau_plate: orNull(profile?.macauPlate),
    mainland_plate: orNull(profile?.mainlandPlate),
    vehicle_type: orNull(profile?.vehicleType),
    hk_macau_phone: orNull(profile?.hkMacauPhone),
    mainland_phone: orNull(profile?.mainlandPhone),
    admin_url: adminBaseUrl ? `${adminBaseUrl}/users/${encodeURIComponent(user.id)}` : null,
  };
  return {
    ...(name ? { name } : {}),
    phone: `${user.countryCode}${user.phone}`,
    type: '司機',
    ...(LOCALES.has(user.locale) ? { locale: user.locale } : {}),
    attributes,
  };
}

export type SyncResult = 'ok' | 'skipped' | 'failed';
export type RemoveResult = 'removed' | 'skipped' | 'failed';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 客服 is MasterBox Chat Box (2026-11-18). Drivers are kept as MasterBox customers (2026-11-20), so staff there see
 * who they talk to and can find a driver who has never opened 客服: sent when a driver signs in, when they or the
 * platform's staff save their details, and for everyone at once with `npm run masterbox -- --sync-all`. A deleted
 * account's customer, conversations and files go too. Nothing is sent without MASTERBOX_API_KEY. A failure is
 * logged and never fails what the driver or staff did.
 */
@Injectable()
export class MasterBoxCustomers {
  private readonly logger = new Logger(MasterBoxCustomers.name);
  /** Replaced in tests. */
  fetcher: typeof fetch = (input, init) => fetch(input, init);

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  get enabled() {
    return Boolean(this.config.masterboxAppId && this.config.masterboxApiKey);
  }

  /** In the background: what called it goes on at once. */
  sync(userId: string) {
    if (this.enabled) void this.syncNow(userId);
  }

  async syncNow(userId: string): Promise<SyncResult> {
    if (!this.enabled) return 'skipped';
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          countryCode: true,
          phone: true,
          locale: true,
          profile: { select: { name: true, hkPlate: true, macauPlate: true, mainlandPlate: true, vehicleType: true, hkMacauPhone: true, mainlandPhone: true } },
        },
      });
      if (!user) return 'skipped';
      const response = await this.call('PUT', userId, customerBody(user, this.config.adminBaseUrl));
      if (response.ok) return 'ok';
      this.logger.warn(`MasterBox customer ${userId} not updated: ${await describe(response)}`);
      return 'failed';
    } catch (error) {
      this.logger.warn(`MasterBox customer ${userId} not updated: ${(error as Error).message}`);
      return 'failed';
    }
  }

  /** The account is deleted here: its MasterBox customer too, with their conversations and files. Not undone. */
  async remove(userId: string): Promise<RemoveResult> {
    if (!this.enabled) return 'skipped';
    try {
      const response = await this.call('DELETE', userId);
      // Never there (never signed in since, or removed already): nothing is left in MasterBox.
      if (response.ok || response.status === 404) return 'removed';
      this.logger.warn(`MasterBox customer ${userId} not deleted: ${await describe(response)}`);
      return 'failed';
    } catch (error) {
      this.logger.warn(`MasterBox customer ${userId} not deleted: ${(error as Error).message}`);
      return 'failed';
    }
  }

  /** One request, once more after the wait MasterBox asks for when the company's requests per minute ran out. */
  private async call(method: 'PUT' | 'DELETE', userId: string, body?: object): Promise<Response> {
    const send = () =>
      this.fetcher(`${MASTERBOX_API}/customers/${encodeURIComponent(userId)}`, {
        method,
        headers: {
          'X-App-Id': this.config.masterboxAppId ?? '',
          'X-Api-Key': this.config.masterboxApiKey ?? '',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    const response = await send();
    if (response.status !== 429) return response;
    const seconds = Number(response.headers.get('Retry-After'));
    await wait((Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 60) : RETRY_AFTER_DEFAULT_SECONDS) * 1000);
    return send();
  }
}

/** MasterBox's error (`{ error: { code, message } }`), for the log. */
async function describe(response: Response) {
  try {
    const { error } = (await response.json()) as { error?: { code?: string; message?: string } };
    if (error?.code) return `${response.status} ${error.code}: ${error.message ?? ''}`.trim();
  } catch {
    // Not JSON.
  }
  return String(response.status);
}
