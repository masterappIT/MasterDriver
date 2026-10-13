import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_PAYMENT_METHODS = ["card", "apple_pay", "google_pay", "alipay", "wechat_pay"] as const;
export type StripePaymentMethod = (typeof STRIPE_PAYMENT_METHODS)[number];
export type StripeEnvironment = "sandbox" | "production";

const STRIPE_API_BASE = "https://api.stripe.com";
const STRIPE_SETTLEMENT_CURRENCY = "hkd";

export type StripeConfigInput = {
  environment: StripeEnvironment;
  displayName: string | null | undefined;
  description: string | null | undefined;
  publishableKey: string;
  secretKey: string;
  webhookSecret: string;
  paymentMethods: StripePaymentMethod[];
};

export type StripeAccountSnapshot = {
  id: string;
  name: string | null;
  country: string | null;
  defaultCurrency: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  methods: Partial<Record<StripePaymentMethod, boolean>>;
};

export type StripeTestResult = {
  status: "success" | "warning" | "error";
  message: string;
  account: StripeAccountSnapshot | null;
};

export function isStripePaymentMethod(value: unknown): value is StripePaymentMethod {
  return typeof value === "string" && (STRIPE_PAYMENT_METHODS as readonly string[]).includes(value);
}

function keyMatchesEnvironment(key: string, kinds: string[], environment: StripeEnvironment) {
  const mode = environment === "production" ? "live" : "test";
  return kinds.some((kind) => new RegExp(`^${kind}_${mode}_[A-Za-z0-9]{10,}$`).test(key));
}

/** Validates an admin save request. A blank secret key or webhook secret means "keep the stored one"; the secret key must exist for a new config. */
export function parseStripeConfigInput(
  body: Record<string, unknown>,
  hasStoredSecretKey: boolean,
): { value: StripeConfigInput } | { error: string } {
  const environment = body.environment === "production" ? "production" : body.environment === "sandbox" ? "sandbox" : null;
  if (!environment) return { error: "Stripe environment is invalid" };
  const displayName = typeof body.name === "string" ? body.name.trim() || null : undefined;
  const description = typeof body.description === "string" ? body.description.trim() || null : undefined;
  if ((displayName?.length ?? 0) > 80 || (description?.length ?? 0) > 500) return { error: "Stripe name or description is too long" };
  const publishableKey = typeof body.publishableKey === "string" ? body.publishableKey.trim() : "";
  const secretKey = typeof body.secretKey === "string" ? body.secretKey.trim() : "";
  if (!keyMatchesEnvironment(publishableKey, ["pk"], environment)) return { error: "Stripe publishable key does not match the environment" };
  if (!secretKey && !hasStoredSecretKey) return { error: "Stripe secret key is required for new configurations" };
  if (secretKey && !keyMatchesEnvironment(secretKey, ["sk", "rk"], environment)) return { error: "Stripe secret key does not match the environment" };
  const webhookSecret = typeof body.webhookSecret === "string" ? body.webhookSecret.trim() : "";
  if (webhookSecret && !/^whsec_[A-Za-z0-9]{10,}$/.test(webhookSecret)) return { error: "Stripe webhook signing secret format is invalid" };
  const paymentMethods = Array.isArray(body.paymentMethods) ? [...new Set(body.paymentMethods.filter(isStripePaymentMethod))] : [];
  if (!paymentMethods.length) return { error: "Stripe payment methods are required" };
  return { value: { environment, displayName, description, publishableKey, secretKey, webhookSecret, paymentMethods } };
}

type StripeFetch = (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

async function stripeGet(fetchImpl: StripeFetch, secretKey: string, path: string) {
  const response = await fetchImpl(`${STRIPE_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(10_000),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  return { ok: response.ok, status: response.status, body };
}

const METHOD_LABELS: Record<StripePaymentMethod, string> = {
  card: "信用卡／扣帳卡",
  apple_pay: "Apple Pay",
  google_pay: "Google Pay",
  alipay: "支付寶",
  wechat_pay: "微信支付",
};

/**
 * Calls Stripe with the saved secret key and reports whether the account can take HKD-settled payments
 * with the selected methods. Reads account data only; never creates a charge. Messages never contain the key.
 */
export async function testStripeConnection(
  secretKey: string,
  paymentMethods: StripePaymentMethod[],
  fetchImpl: StripeFetch = fetch as unknown as StripeFetch,
): Promise<StripeTestResult> {
  let accountResponse: Awaited<ReturnType<typeof stripeGet>>;
  try {
    accountResponse = await stripeGet(fetchImpl, secretKey, "/v1/account");
  } catch {
    return { status: "error", message: "無法連線到 Stripe，請稍後重試。", account: null };
  }
  if (accountResponse.status === 401) return { status: "error", message: "Stripe 拒絕了這組 Secret Key：金鑰無效、已被撤銷或已輪替。", account: null };
  if (accountResponse.status === 403) return { status: "error", message: "此金鑰沒有讀取帳戶資料的權限；受限金鑰需開放帳戶讀取權限。", account: null };
  if (!accountResponse.ok || typeof accountResponse.body?.id !== "string") {
    return { status: "error", message: `Stripe 回應異常（HTTP ${accountResponse.status}），請稍後重試。`, account: null };
  }

  const raw = accountResponse.body;
  const businessProfile = (raw.business_profile ?? null) as { name?: unknown } | null;
  const dashboard = ((raw.settings ?? null) as { dashboard?: { display_name?: unknown } } | null)?.dashboard;
  const account: StripeAccountSnapshot = {
    id: raw.id as string,
    name: typeof dashboard?.display_name === "string" ? dashboard.display_name : typeof businessProfile?.name === "string" ? businessProfile.name : null,
    country: typeof raw.country === "string" ? raw.country : null,
    defaultCurrency: typeof raw.default_currency === "string" ? raw.default_currency : null,
    chargesEnabled: raw.charges_enabled === true,
    payoutsEnabled: raw.payouts_enabled === true,
    methods: {},
  };

  if (!account.chargesEnabled) return { status: "error", message: "已連線 Stripe，但此帳戶尚未開通收款，請先在 Stripe 後台完成帳戶啟用。", account };
  if (account.defaultCurrency !== STRIPE_SETTLEMENT_CURRENCY) {
    return { status: "error", message: `已連線 Stripe，但帳戶預設結算貨幣是 ${(account.defaultCurrency ?? "未知").toUpperCase()}，不是 HKD，不能作為港幣結算渠道。`, account };
  }

  // Method availability is advisory: it needs a separate permission and must not fail an otherwise valid key.
  let methodsKnown = false;
  try {
    const methodsResponse = await stripeGet(fetchImpl, secretKey, "/v1/payment_method_configurations?limit=100");
    const configurations = Array.isArray(methodsResponse.body?.data) ? (methodsResponse.body.data as Record<string, unknown>[]) : [];
    const configuration = configurations.find((item) => item.is_default === true && item.active !== false) ?? configurations.find((item) => item.active !== false);
    if (methodsResponse.ok && configuration) {
      methodsKnown = true;
      for (const method of STRIPE_PAYMENT_METHODS) account.methods[method] = (configuration[method] as { available?: unknown } | undefined)?.available === true;
    }
  } catch {
    methodsKnown = false;
  }

  if (!methodsKnown) return { status: "warning", message: "已連線 Stripe 且帳戶可收款，但無法讀取付款方式的啟用狀態，請在 Stripe 後台確認。", account };
  const unavailable = paymentMethods.filter((method) => !account.methods[method]);
  if (unavailable.length) {
    return { status: "warning", message: `已連線 Stripe 且帳戶可收款；以下已選付款方式在 Stripe 帳戶尚未啟用：${unavailable.map((method) => METHOD_LABELS[method]).join("、")}。`, account };
  }
  return { status: "success", message: "已連線 Stripe，帳戶可收款，已選付款方式均已啟用。", account };
}

/**
 * Verifies a Stripe-Signature header (`t=<unix>,v1=<hex>[,v1=<hex>]`) against the exact request bytes.
 * The signed payload is `<t>.<body>`, HMAC-SHA256 with the endpoint's signing secret; old timestamps are rejected to limit replay.
 */
export function verifyStripeWebhookSignature(rawBody: Buffer, header: string | undefined, signingSecret: string, nowMs = Date.now(), toleranceSeconds = 300) {
  if (!header || !signingSecret) return false;
  const parts = header.split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !/^\d+$/.test(timestamp) || !signatures.length) return false;
  if (Math.abs(nowMs / 1000 - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", signingSecret).update(`${timestamp}.`).update(rawBody).digest();
  return signatures.some((signature) => {
    if (!/^[0-9a-f]{64}$/i.test(signature ?? "")) return false;
    return timingSafeEqual(Buffer.from(signature, "hex"), expected);
  });
}
