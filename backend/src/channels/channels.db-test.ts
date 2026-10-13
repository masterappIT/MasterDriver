import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { after, before, beforeEach, test } from 'node:test';
import { rejectsWith, setupDatabase, type TestContext } from '../test/database';

let ctx: TestContext;
const fake = (kind: string, mode: string) => [kind, mode, 'abcdefghij1234567890'].join('_');

/** Records 253 / Stripe calls and answers with the given body. */
function stubFetch(body: Record<string, unknown>, status = 200) {
  const calls: { url: string; body: Record<string, unknown> }[] = [];
  const impl = async (url: string, init: { body?: string }) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : {} });
    return { ok: status < 400, status, json: async () => body };
  };
  return { calls, impl: impl as never };
}

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

test('Stripe keys are stored encrypted, never returned, and kept when left blank', async () => {
  const channels = await ctx.paymentChannels.saveStripe(
    'sandbox',
    { publishableKey: fake('pk', 'test'), secretKey: fake('sk', 'test'), webhookSecret: 'whsec_abcdefghij1234567890', paymentMethods: ['card', 'alipay'] },
    'test',
  );
  const sandbox = channels.find((c) => c.provider === 'STRIPE' && c.environment === 'sandbox')!;
  assert.equal(sandbox.secretKeyConfigured, true);
  assert.ok(!JSON.stringify(channels).includes('sk_test'));
  const row = await ctx.prisma.paymentChannel.findFirstOrThrow({ where: { provider: 'STRIPE' } });
  assert.ok(row.secretKeyEnc?.startsWith('v1.') && !row.secretKeyEnc.includes('sk_test'));

  await ctx.paymentChannels.saveStripe('sandbox', { publishableKey: fake('pk', 'test'), secretKey: '', paymentMethods: ['card'] }, 'test');
  const kept = await ctx.prisma.paymentChannel.findFirstOrThrow({ where: { provider: 'STRIPE' } });
  assert.equal(ctx.box.open(kept.secretKeyEnc!), fake('sk', 'test'));
  await rejectsWith(
    ctx.paymentChannels.saveStripe('production', { publishableKey: fake('pk', 'test'), secretKey: fake('sk', 'test'), paymentMethods: ['card'] }, 'test'),
    'STRIPE_CONFIG_INVALID',
  );
});

test('a channel can be enabled only after its check passes, one environment at a time', async () => {
  await ctx.paymentChannels.saveStripe('sandbox', { publishableKey: fake('pk', 'test'), secretKey: fake('sk', 'test'), paymentMethods: ['card'] }, 'test');
  await rejectsWith(ctx.paymentChannels.setEnabled('STRIPE', 'sandbox', true, 'test'), 'CHANNEL_NOT_TESTED');
  const stripe = stubFetch({ id: 'acct_1', charges_enabled: true, default_currency: 'hkd', country: 'HK' });
  ctx.paymentChannels.fetchImpl = stripe.impl;
  const tested = await ctx.paymentChannels.testStripe('sandbox');
  assert.notEqual(tested.status, 'error');
  assert.equal(stripe.calls[0].url, 'https://api.stripe.com/v1/account');
  const enabled = await ctx.paymentChannels.setEnabled('STRIPE', 'sandbox', true, 'test');
  assert.equal(enabled.find((c) => c.provider === 'STRIPE' && c.environment === 'sandbox')!.enabled, true);
});

test('AlipayHK follows Master Travel rules and its check only reads the keys', async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = {
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
  await rejectsWith(ctx.paymentChannels.saveAlipayHk('sandbox', { gatewayUrl: 'https://openapi.alipay.com', partner: '1234', ...pem }, 'test'), 'ALIPAYHK_PARTNER_FORMAT');
  await rejectsWith(ctx.paymentChannels.saveAlipayHk('sandbox', { gatewayUrl: 'https://openapi.alipay.com', partner: '2160000000000001', privateKey: 'nope', publicKey: pem.publicKey }, 'test'), 'ALIPAYHK_PRIVATE_KEY_FORMAT');
  await ctx.paymentChannels.saveAlipayHk('sandbox', { gatewayUrl: 'https://openapi.alipay.com', partner: '2160000000000001', ...pem }, 'test');
  const result = await ctx.paymentChannels.testAlipayHk('sandbox');
  assert.equal(result.status, 'success');
  assert.ok(!JSON.stringify(result).includes('PRIVATE KEY'));
});

test('sign-in SMS goes to the domestic account for +86 and the international one for +852', async () => {
  await ctx.smsChannels.save('DOMESTIC', { enabled: true, account: 'cn-acct', password: 'cn-pass' }, 'test');
  await ctx.smsChannels.save('INTERNATIONAL', { enabled: true, endpoint: 'https://intapi.253.com', account: 'hk-acct', password: 'hk-pass' }, 'test');
  const stub = stubFetch({ code: '0' });
  ctx.smsChannels.fetchImpl = stub.impl;

  await ctx.smsChannels.sendVerificationCode('+86', '13800138000', '480917');
  await ctx.smsChannels.sendVerificationCode('+852', '91234567', '736205');
  assert.equal(stub.calls[0].url, 'https://smssh1.253.com/msg/send/json');
  assert.equal(stub.calls[0].body.account, 'cn-acct');
  assert.equal(stub.calls[0].body.phone, '13800138000');
  assert.ok(String(stub.calls[0].body.msg).includes('480917'));
  assert.equal(stub.calls[1].url, 'https://intapi.253.com/msg/send/json');
  assert.equal(stub.calls[1].body.account, 'hk-acct');
  assert.equal(stub.calls[1].body.phone, '85291234567');

  const logged = await ctx.prisma.smsMessage.findMany();
  assert.equal(logged.length, 2);
  for (const code of ['480917', '736205']) assert.ok(!JSON.stringify(logged).includes(code), 'the code is never stored');
  assert.ok(!JSON.stringify(await ctx.smsChannels.list()).includes('cn-pass'), 'the password is never returned');
});

test('a rejected SMS fails the request; an unconfigured route refuses outside development', async () => {
  await ctx.smsChannels.save('DOMESTIC', { enabled: true, account: 'cn-acct', password: 'cn-pass' }, 'test');
  ctx.smsChannels.fetchImpl = stubFetch({ code: '107', errorMsg: '手機號碼格式錯誤' }).impl;
  await rejectsWith(ctx.smsChannels.sendVerificationCode('+86', '13800138000', '123456'), 'SMS_SEND_FAILED');
  assert.equal((await ctx.prisma.smsMessage.findFirstOrThrow()).status, 'rejected');
  await rejectsWith(ctx.smsChannels.sendVerificationCode('+853', '61234567', '123456'), 'SMS_NOT_CONFIGURED');
});

test('Spug sends for a route under its own template: the code and number go in, the template code stays secret', async () => {
  await ctx.smsChannels.save('DOMESTIC', { enabled: true, account: 'cn-acct', password: 'cn-pass' }, 'test');
  // Switching provider starts clean: the 253 account is gone and the route is off until Spug is filled in.
  const switched = (await ctx.smsChannels.save('DOMESTIC', { provider: 'SPUG' }, 'test')).find((c) => c.route === 'DOMESTIC');
  assert.equal(switched?.provider, 'SPUG');
  assert.equal(switched?.enabled, false);
  assert.equal(switched?.passwordConfigured, false);
  assert.equal(switched?.endpoint, 'https://push.spug.cc');
  await rejectsWith(ctx.smsChannels.save('DOMESTIC', { enabled: true }, 'test'), 'SMS_ACCOUNT_REQUIRED');
  await rejectsWith(ctx.smsChannels.save('DOMESTIC', { password: 'not a code!' }, 'test'), 'SPUG_TEMPLATE_CODE_INVALID');

  // The whole URL copied from the Spug console is accepted; only its code is kept.
  await ctx.smsChannels.save('DOMESTIC', { enabled: true, account: '跨境師傅幫', password: 'https://push.spug.cc/send/A27LsecretbgEY' }, 'test');
  const stub = stubFetch({ code: 200, msg: '请求成功' });
  ctx.smsChannels.fetchImpl = stub.impl;
  await ctx.smsChannels.sendVerificationCode('+86', '13800138000', '480917');
  assert.equal(stub.calls[0].url, 'https://push.spug.cc/send/A27LsecretbgEY');
  assert.deepEqual(stub.calls[0].body, { name: '跨境師傅幫', code: '480917', targets: '13800138000' });

  const logged = await ctx.prisma.smsMessage.findFirstOrThrow();
  assert.equal(logged.provider, 'SPUG');
  assert.equal(logged.status, 'sent');
  assert.ok(!JSON.stringify(logged).includes('480917'), 'the code is never stored');
  assert.ok(!JSON.stringify(await ctx.smsChannels.list()).includes('A27LsecretbgEY'), 'the template code is never returned');

  ctx.smsChannels.fetchImpl = stubFetch({ code: 204, msg: '余额不足' }).impl;
  await rejectsWith(ctx.smsChannels.sendVerificationCode('+86', '13800138000', '123456'), 'SMS_SEND_FAILED');
  assert.equal((await ctx.smsChannels.testConnection('DOMESTIC')).status, 'skipped');
  // The other route is untouched.
  assert.equal((await ctx.smsChannels.list()).find((c) => c.route === 'INTERNATIONAL')?.provider, 'SMS253');
});

test('a channel cannot be enabled without credentials, and templates need {code}', async () => {
  await rejectsWith(ctx.smsChannels.save('INTERNATIONAL', { enabled: true }, 'test'), 'SMS_ACCOUNT_REQUIRED');
  ctx.smsChannels.fetchImpl = stubFetch({ code: '0', balance: '1234' }).impl;
  await ctx.smsChannels.save('INTERNATIONAL', { endpoint: 'https://intapi.253.com', account: 'hk', password: 'pw' }, 'test');
  const result = await ctx.smsChannels.testConnection('INTERNATIONAL');
  assert.equal(result.status, 'success');
  assert.ok(result.message.includes('1234'));
});
