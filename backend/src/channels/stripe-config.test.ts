import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { parseStripeConfigInput, testStripeConnection, verifyStripeWebhookSignature } from "./stripe-config";

// Assembled at runtime so the fixtures are never mistaken for real credentials by secret scanners.
const fakeKey = (kind: string, mode: string) => [kind, mode, "abcdefghij1234567890"].join("_");
const PK_TEST = fakeKey("pk", "test");
const SK_TEST = fakeKey("sk", "test");
const SK_LIVE = fakeKey("sk", "live");

function stripeStub(responses: Record<string, { status: number; body: unknown }>) {
  const calls: { url: string; authorization: string }[] = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    calls.push({ url, authorization: init.headers.Authorization });
    const path = Object.keys(responses).find((key) => url.includes(key));
    if (!path) throw new Error("network down");
    const { status, body } = responses[path];
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetchImpl, calls };
}

const hkAccount = { id: "acct_1", country: "HK", default_currency: "hkd", charges_enabled: true, payouts_enabled: true, settings: { dashboard: { display_name: "Master Travel" } } };
const methods = (available: string[]) => ({
  data: [{ is_default: true, active: true, ...Object.fromEntries(["card", "apple_pay", "google_pay", "alipay", "wechat_pay"].map((key) => [key, { available: available.includes(key) }])) }],
});

test("accepts a new sandbox configuration and de-duplicates payment methods", () => {
  const result = parseStripeConfigInput({ environment: "sandbox", name: " Stripe 測試 ", publishableKey: PK_TEST, secretKey: SK_TEST, paymentMethods: ["card", "card", "alipay", "bogus"] }, false);
  assert.ok("value" in result);
  assert.equal(result.value.displayName, "Stripe 測試");
  assert.deepEqual(result.value.paymentMethods, ["card", "alipay"]);
});

test("rejects keys that belong to the other environment", () => {
  const liveSecretInSandbox = parseStripeConfigInput({ environment: "sandbox", publishableKey: PK_TEST, secretKey: SK_LIVE, paymentMethods: ["card"] }, false);
  assert.deepEqual(liveSecretInSandbox, { error: "Stripe secret key does not match the environment" });
  const testPublishableInProduction = parseStripeConfigInput({ environment: "production", publishableKey: PK_TEST, secretKey: SK_LIVE, paymentMethods: ["card"] }, false);
  assert.deepEqual(testPublishableInProduction, { error: "Stripe publishable key does not match the environment" });
});

test("a blank secret key keeps the stored one but is required for a new configuration", () => {
  const body = { environment: "sandbox", publishableKey: PK_TEST, secretKey: "", paymentMethods: ["card"] };
  assert.ok("value" in parseStripeConfigInput(body, true));
  assert.deepEqual(parseStripeConfigInput(body, false), { error: "Stripe secret key is required for new configurations" });
});

test("accepts restricted keys and requires at least one payment method", () => {
  assert.ok("value" in parseStripeConfigInput({ environment: "sandbox", publishableKey: PK_TEST, secretKey: fakeKey("rk", "test"), paymentMethods: ["card"] }, false));
  assert.deepEqual(parseStripeConfigInput({ environment: "sandbox", publishableKey: PK_TEST, secretKey: SK_TEST, paymentMethods: [] }, false), { error: "Stripe payment methods are required" });
});

test("reports success when the HK account can charge and every selected method is available", async () => {
  const { fetchImpl, calls } = stripeStub({ "/v1/account": { status: 200, body: hkAccount }, "/v1/payment_method_configurations": { status: 200, body: methods(["card", "alipay"]) } });
  const result = await testStripeConnection(SK_TEST, ["card", "alipay"], fetchImpl);
  assert.equal(result.status, "success");
  assert.equal(result.account?.id, "acct_1");
  assert.equal(result.account?.name, "Master Travel");
  assert.equal(result.account?.methods.wechat_pay, false);
  assert.equal(calls[0].authorization, `Bearer ${SK_TEST}`);
});

test("warns about selected methods the Stripe account has not enabled", async () => {
  const { fetchImpl } = stripeStub({ "/v1/account": { status: 200, body: hkAccount }, "/v1/payment_method_configurations": { status: 200, body: methods(["card"]) } });
  const result = await testStripeConnection(SK_TEST, ["card", "wechat_pay"], fetchImpl);
  assert.equal(result.status, "warning");
  assert.match(result.message, /微信支付/);
  assert.doesNotMatch(result.message, /信用卡/);
});

test("an invalid key is an error and the message never contains the key", async () => {
  const { fetchImpl } = stripeStub({ "/v1/account": { status: 401, body: { error: { message: `Invalid API Key provided: ${SK_TEST}` } } } });
  const result = await testStripeConnection(SK_TEST, ["card"], fetchImpl);
  assert.equal(result.status, "error");
  assert.equal(result.account, null);
  assert.ok(!result.message.includes(SK_TEST));
});

test("rejects accounts that cannot charge or do not settle in HKD", async () => {
  const notEnabled = stripeStub({ "/v1/account": { status: 200, body: { ...hkAccount, charges_enabled: false } } });
  assert.equal((await testStripeConnection(SK_TEST, ["card"], notEnabled.fetchImpl)).status, "error");
  const usd = stripeStub({ "/v1/account": { status: 200, body: { ...hkAccount, country: "US", default_currency: "usd" } } });
  const result = await testStripeConnection(SK_TEST, ["card"], usd.fetchImpl);
  assert.equal(result.status, "error");
  assert.match(result.message, /USD/);
});

test("a network failure is an error; unreadable method settings only downgrade to a warning", async () => {
  assert.equal((await testStripeConnection(SK_TEST, ["card"], stripeStub({}).fetchImpl)).status, "error");
  const noMethodPermission = stripeStub({ "/v1/account": { status: 200, body: hkAccount }, "/v1/payment_method_configurations": { status: 403, body: { error: {} } } });
  const result = await testStripeConnection(SK_TEST, ["card"], noMethodPermission.fetchImpl);
  assert.equal(result.status, "warning");
  assert.equal(result.account?.chargesEnabled, true);
});

const WHSEC = "whsec_abcdefghij1234567890";
const signedHeader = (body: string, timestamp: number, secret = WHSEC) => `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;

test("validates the webhook signing secret format and lets it stay blank", () => {
  const base = { environment: "sandbox", publishableKey: PK_TEST, secretKey: SK_TEST, paymentMethods: ["card"] };
  assert.deepEqual(parseStripeConfigInput({ ...base, webhookSecret: "secret" }, false), { error: "Stripe webhook signing secret format is invalid" });
  const withSecret = parseStripeConfigInput({ ...base, webhookSecret: WHSEC }, false);
  assert.ok("value" in withSecret && withSecret.value.webhookSecret === WHSEC);
  const blank = parseStripeConfigInput(base, false);
  assert.ok("value" in blank && blank.value.webhookSecret === "");
});

test("accepts a webhook signed with the endpoint secret over the exact body", () => {
  const body = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = 1_800_000_000_000;
  const header = signedHeader(body, now / 1000);
  assert.equal(verifyStripeWebhookSignature(Buffer.from(body), header, WHSEC, now), true);
  assert.equal(verifyStripeWebhookSignature(Buffer.from(body), `${header},v1=${"0".repeat(64)}`, WHSEC, now), true);
});

test("rejects tampered bodies, wrong secrets, stale timestamps and malformed headers", () => {
  const body = '{"id":"evt_1","type":"checkout.session.completed"}';
  const now = 1_800_000_000_000;
  const header = signedHeader(body, now / 1000);
  assert.equal(verifyStripeWebhookSignature(Buffer.from(body.replace("evt_1", "evt_2")), header, WHSEC, now), false);
  assert.equal(verifyStripeWebhookSignature(Buffer.from(body), signedHeader(body, now / 1000, "whsec_other00000000000"), WHSEC, now), false);
  assert.equal(verifyStripeWebhookSignature(Buffer.from(body), header, WHSEC, now + 301_000), false);
  for (const malformed of [undefined, "", "v1=abc", "t=abc,v1=abc", `t=${now / 1000}`, `t=${now / 1000},v1=nothex`]) {
    assert.equal(verifyStripeWebhookSignature(Buffer.from(body), malformed, WHSEC, now), false);
  }
});
