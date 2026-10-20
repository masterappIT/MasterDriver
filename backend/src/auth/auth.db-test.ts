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

test('a number whose SMS is not set up is refused before a code is stored, and the form is told which areas can sign in', async () => {
  ctx.sms.closed.add('+852');
  assert.deepEqual((await ctx.auth.signInAreas()).areas, [
    { countryCode: '+852', available: false },
    { countryCode: '+86', available: true },
    { countryCode: '+853', available: true },
  ]);
  await rejectsWith(ctx.auth.requestCode(phone, '1.1.1.1'), 'SMS_NOT_CONFIGURED');
  assert.equal(await ctx.prisma.verificationCode.count(), 0);
  // Once it is set up the number can ask at once: the refusal left no resend wait behind.
  ctx.sms.closed.clear();
  await ctx.auth.requestCode(phone, '1.1.1.1');
  assert.equal(ctx.sms.sent.length, 1);
});

test('development mode lets every area sign in, set up or not', async () => {
  ctx.sms.closed.add('+852');
  await ctx.developmentLogin.update({ enabled: true }, 'test');
  assert.ok((await ctx.auth.signInAreas()).areas.every((area) => area.available));
  await ctx.auth.requestCode(phone, undefined);
  assert.equal(ctx.sms.sent.length, 0);
});

test('a wrong code counts against the limit and then locks', async () => {
  await ctx.auth.requestCode(phone, '1.1.1.1');
  const wrong = ctx.sms.sent[0].code === '111111' ? '222222' : '111111';
  for (let i = 0; i < 5; i += 1) await rejectsWith(ctx.auth.verifyCode({ ...phone, code: wrong }, undefined), 'OTP_INVALID');
  await rejectsWith(ctx.auth.verifyCode({ ...phone, code: ctx.sms.sent[0].code }, undefined), 'OTP_LOCKED');
});

test('a code asked for before 重新發送 still signs in, once, and the others stop working', async () => {
  await ctx.auth.requestCode(phone, '1.1.1.1');
  await ctx.auth.requestCode(phone, '1.1.1.1', later(61));
  const [first, second] = ctx.sms.sent.map((sent) => sent.code);
  await ctx.auth.verifyCode({ ...phone, code: first }, undefined, later(62));
  await rejectsWith(ctx.auth.verifyCode({ ...phone, code: second }, undefined, later(63)), 'OTP_INVALID');
  // Only the code typed counts as used; the other expired, so 驗證碼等待時間 sees one sign-in.
  const rows = await ctx.prisma.verificationCode.findMany({ orderBy: { createdAt: 'asc' } });
  assert.deepEqual(rows.map((row) => row.consumedAt !== null), [true, false]);
  assert.ok(rows[1].expiresAt <= later(62));
});

test('驗證碼等待時間 counts SMS sign-ins from their first code, and leaves out development mode', async () => {
  await ctx.auth.requestCode(phone, '1.1.1.1');
  await ctx.auth.requestCode(phone, '1.1.1.1', later(61));
  await ctx.auth.verifyCode({ ...phone, code: ctx.sms.sent[0].code }, undefined, later(80));
  await ctx.auth.requestCode({ countryCode: '+86', phone: '13800138000' }, '1.1.1.1');
  await ctx.developmentLogin.update({ enabled: true }, 'test');
  await ctx.auth.requestCode({ countryCode: '+853', phone: '66123456' }, '1.1.1.1');
  await ctx.auth.verifyCode({ countryCode: '+853', phone: '66123456', code: DEFAULT_DEVELOPMENT_CODE }, undefined);

  const { days, routes } = await ctx.smsChannels.waits(later(90));
  assert.equal(days, 7);
  const [domestic, international] = routes;
  assert.deepEqual([domestic.attempts, domestic.signedIn, domestic.notSignedIn], [1, 0, 1]);
  assert.deepEqual([international.attempts, international.signedIn, international.notSignedIn], [1, 1, 0]);
  assert.ok(international.medianSeconds! >= 79 && international.medianSeconds! <= 81);
});

test('only the three newest live codes sign in', async () => {
  for (let i = 0; i < 4; i += 1) await ctx.auth.requestCode(phone, '1.1.1.1', later(61 * i));
  const codes = ctx.sms.sent.map((sent) => sent.code);
  if (!codes.slice(1).includes(codes[0])) {
    await rejectsWith(ctx.auth.verifyCode({ ...phone, code: codes[0] }, undefined, later(200)), 'OTP_INVALID');
  }
  await ctx.auth.verifyCode({ ...phone, code: codes[1] }, undefined, later(200));
});

test('a wrong code counts against every live code, so five wrong tries lock them all', async () => {
  await ctx.auth.requestCode(phone, '1.1.1.1');
  await ctx.auth.requestCode(phone, '1.1.1.1', later(61));
  const codes = ctx.sms.sent.map((sent) => sent.code);
  const wrong = ['111111', '222222', '333333'].find((candidate) => !codes.includes(candidate))!;
  for (let i = 0; i < 5; i += 1) await rejectsWith(ctx.auth.verifyCode({ ...phone, code: wrong }, undefined, later(62)), 'OTP_INVALID');
  for (const code of codes) await rejectsWith(ctx.auth.verifyCode({ ...phone, code }, undefined, later(63)), 'OTP_LOCKED');
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
