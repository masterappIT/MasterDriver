import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { setupDatabase, type TestContext, rejectsWith } from '../test/database';
import { DEFAULT_DEVELOPMENT_CODE } from './development-login.service';

let ctx: TestContext;
const phone = { countryCode: '+852' as const, phone: '91234567' };
const later = (seconds: number) => new Date(Date.now() + seconds * 1000);

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

test('an SMS code signs in once and creates a long-lived session', async () => {
  await ctx.auth.requestCode(phone, '1.1.1.1');
  const { code } = ctx.sms.sent[0];
  const result = await ctx.auth.verifyCode({ ...phone, code }, 'test-agent');
  assert.equal(result.user.locale, 'zh-Hant');
  assert.ok(await ctx.auth.resolveSession(result.token));
  await rejectsWith(ctx.auth.verifyCode({ ...phone, code }, undefined), 'OTP_INVALID');
});

test('a wrong code counts against the limit and then locks', async () => {
  await ctx.auth.requestCode(phone, '1.1.1.1');
  const wrong = ctx.sms.sent[0].code === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i += 1) await rejectsWith(ctx.auth.verifyCode({ ...phone, code: wrong }, undefined), 'OTP_INVALID');
  await rejectsWith(ctx.auth.verifyCode({ ...phone, code: ctx.sms.sent[0].code }, undefined), 'OTP_LOCKED');
});

test('codes cannot be requested again within a minute', async () => {
  await ctx.auth.requestCode(phone, '1.1.1.1');
  await rejectsWith(ctx.auth.requestCode(phone, '1.1.1.1'), 'OTP_TOO_FREQUENT');
  await ctx.auth.requestCode(phone, '1.1.1.1', later(61));
});

test('a revoked session no longer signs in', async () => {
  await ctx.auth.requestCode(phone, undefined);
  const { token } = await ctx.auth.verifyCode({ ...phone, code: ctx.sms.sent[0].code }, undefined);
  const session = await ctx.auth.resolveSession(token);
  await ctx.auth.revokeSession(session!.sessionId);
  assert.equal(await ctx.auth.resolveSession(token), null);
});

test('development mode sends no SMS and accepts the configured code', async () => {
  await ctx.developmentLogin.update({ enabled: true }, 'test');
  await ctx.auth.requestCode(phone, undefined);
  assert.equal(ctx.sms.sent.length, 0);
  const result = await ctx.auth.verifyCode({ ...phone, code: DEFAULT_DEVELOPMENT_CODE }, undefined);
  assert.ok(result.token);
});

test('an updated development code applies to new requests only', async () => {
  await ctx.developmentLogin.update({ enabled: true }, 'test');
  await ctx.auth.requestCode(phone, undefined);
  await ctx.developmentLogin.update({ code: '246810' }, 'test');

  // The request issued before the change still uses the code in force at that time.
  await rejectsWith(ctx.auth.verifyCode({ ...phone, code: '246810' }, undefined), 'OTP_INVALID');
  await ctx.auth.verifyCode({ ...phone, code: DEFAULT_DEVELOPMENT_CODE }, undefined);

  await ctx.auth.requestCode(phone, undefined, later(61));
  await ctx.auth.verifyCode({ ...phone, code: '246810' }, undefined, later(62));
});

test('switching development mode off returns new requests to SMS', async () => {
  await ctx.developmentLogin.update({ enabled: true }, 'test');
  await ctx.developmentLogin.update({ enabled: false }, 'test');
  await ctx.auth.requestCode(phone, undefined);
  assert.equal(ctx.sms.sent.length, 1);
  const status = await ctx.developmentLogin.status();
  assert.equal(status.enabled, false);
  assert.equal('verificationCodeHash' in status, false);
});

test('development mode keeps the request rate limits', async () => {
  await ctx.developmentLogin.update({ enabled: true }, 'test');
  await ctx.auth.requestCode(phone, undefined);
  await rejectsWith(ctx.auth.requestCode(phone, undefined), 'OTP_TOO_FREQUENT');
});

test('how often a code may be asked for follows 防濫用設定, in development mode too', async () => {
  await ctx.site.updateLimits({ otpResendSeconds: 120, otpPerPhonePerHour: 2 }, 'test');
  const first = await ctx.auth.requestCode(phone, '1.1.1.1');
  assert.equal(first.resendAfterSeconds, 120);
  await rejectsWith(ctx.auth.requestCode(phone, '1.1.1.1', later(61)), 'OTP_TOO_FREQUENT');
  await ctx.developmentLogin.update({ enabled: true, code: '246810' }, 'test');
  await ctx.auth.requestCode(phone, '1.1.1.1', later(121));
  await rejectsWith(ctx.auth.requestCode(phone, '1.1.1.1', later(242)), 'OTP_LIMIT_REACHED');

  await ctx.site.updateLimits({ otpPerIpPerHour: 1 }, 'test');
  await rejectsWith(ctx.auth.requestCode({ countryCode: '+852', phone: '91234568' }, '1.1.1.1', later(300)), 'OTP_LIMIT_REACHED');
  await ctx.auth.requestCode({ countryCode: '+852', phone: '91234568' }, '2.2.2.2', later(300));
});
