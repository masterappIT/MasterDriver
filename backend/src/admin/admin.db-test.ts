import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, rejectsWith, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';

let ctx: TestContext;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 10);
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

async function superAdmin() {
  const { password } = await ctx.adminAuth.createAccount({ username: 'boss', displayName: 'Boss', role: 'SUPER_ADMIN' }, null);
  const { token } = await ctx.adminAuth.login({ username: 'boss', password }, '1.1.1.1', undefined);
  return (await ctx.adminAuth.resolveSession(token))!;
}

test('the one-time password signs in; the password is stored only as a hash', async () => {
  const { password } = await ctx.adminAuth.createAccount({ username: 'ops', displayName: 'Ops', role: 'OPERATOR' }, null);
  const stored = await ctx.prisma.administrator.findUniqueOrThrow({ where: { username: 'ops' } });
  assert.ok(stored.passwordHash.startsWith('scrypt$'));
  assert.ok(!stored.passwordHash.includes(password));
  const { token, admin } = await ctx.adminAuth.login({ username: 'ops', password }, undefined, undefined);
  assert.equal(admin.role, 'OPERATOR');
  assert.ok(await ctx.adminAuth.resolveSession(token));
});

test('five wrong passwords lock the username for a while', async () => {
  const { password } = await ctx.adminAuth.createAccount({ username: 'ops', displayName: 'Ops', role: 'OPERATOR' }, null);
  for (let i = 0; i < 5; i += 1) {
    await rejectsWith(ctx.adminAuth.login({ username: 'ops', password: 'wrong' }, '2.2.2.2', undefined), 'ADMIN_LOGIN_INVALID');
  }
  await rejectsWith(ctx.adminAuth.login({ username: 'ops', password }, '2.2.2.2', undefined), 'ADMIN_LOGIN_LOCKED');
});

test('disabling an account ends its sessions; you cannot disable yourself', async () => {
  const boss = await superAdmin();
  const { password } = await ctx.adminAuth.createAccount({ username: 'sales', displayName: 'Sales', role: 'SALES' }, boss.id);
  const { token } = await ctx.adminAuth.login({ username: 'sales', password }, undefined, undefined);
  const sales = await ctx.prisma.administrator.findUniqueOrThrow({ where: { username: 'sales' } });
  await ctx.adminAuth.setDisabled(sales.id, true, boss);
  assert.equal(await ctx.adminAuth.resolveSession(token), null);
  await rejectsWith(ctx.adminAuth.login({ username: 'sales', password }, undefined, undefined), 'ADMIN_LOGIN_INVALID');
  await rejectsWith(ctx.adminAuth.setDisabled(boss.id, true, boss), 'ADMIN_CANNOT_DISABLE_SELF');
});

test('a manual top-up changes credits and is written to the audit log', async () => {
  const boss = await superAdmin();
  const user = await createDriver(ctx);
  const summary = await ctx.adminData.changeCredits(user, { type: 'TOPUP', amount: 50, note: '轉數快 #1' }, boss);
  assert.deepEqual(summary.balance, { amount: 50, currency: 'HKD' });
  const log = await ctx.prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'credits.topup' } });
  assert.equal(log.targetId, user);
  await rejectsWith(ctx.adminData.changeCredits(user, { type: 'TOPUP', amount: -5, note: 'x' }, boss), 'TOPUP_MUST_BE_POSITIVE');
});

test('a plan gift lifts the quota until it is ended', async () => {
  const boss = await superAdmin();
  const user = await createDriver(ctx);
  const gifted = await ctx.adminData.createOverride(user, { planKey: 'company', reason: 'Master Travel 客戶' }, boss);
  assert.equal(gifted.entitlements.orderCreate.quota, null);
  const ended = await ctx.adminData.endOverride(user, gifted.overrides[0].id, boss);
  assert.equal(ended.entitlements.orderCreate.quota, 10);
  assert.equal(ended.overrides[0].active, false);
});

test('ending the free period from the admin takes effect immediately', async () => {
  const boss = await superAdmin();
  const catalogue = await ctx.adminData.createPolicy({ name: '上線全站免費期', planKey: 'company' }, boss);
  const user = await createDriver(ctx);
  assert.equal((await ctx.entitlements.check(user, 'order.create')).quota, null);
  await ctx.adminData.updatePolicy(catalogue.policies[0].id, { active: false }, boss);
  assert.equal((await ctx.entitlements.check(user, 'order.create')).quota, 10);
});

test('the admin sees the money marks, filters by them, and counts what is still open', async () => {
  const boss = await superAdmin();
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const done = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(done.code, driver);
  await ctx.orders.complete(driver, done.id);
  const own = await ctx.orders.create(dispatcher, { ...sampleOrder, selfDrive: true });
  await ctx.orders.complete(dispatcher, own.id);
  await ctx.orders.create(dispatcher, sampleOrder);

  const page = { page: 1 };
  let dashboard = await ctx.adminData.dashboard();
  assert.deepEqual(dashboard.money, { unpaidCompleted: 2, unsettledCompleted: 1 }, '這單我自己做 has nobody to settle with');
  assert.equal((await ctx.adminData.listOrders({ ...page, money: 'UNPAID' }, 'SUPER_ADMIN')).total, 2);
  const unsettled = await ctx.adminData.listOrders({ ...page, money: 'UNSETTLED' }, 'SUPER_ADMIN');
  assert.deepEqual(unsettled.items.map((item) => item.id), [done.id]);
  assert.equal(unsettled.items[0].selfDrive, false);

  await ctx.orders.setPayment(dispatcher, done.id, { paid: true });
  await ctx.orders.setSettlement(dispatcher, done.id, { settled: true });
  dashboard = await ctx.adminData.dashboard();
  assert.deepEqual(dashboard.money, { unpaidCompleted: 1, unsettledCompleted: 0 });
  const detail = await ctx.adminData.getOrder(done.id, boss);
  assert.ok(detail.payment.paidAt && detail.payment.settledAt);
  assert.deepEqual([detail.selfDrive, detail.fromBooking, detail.tripGroup], [false, false, null]);
  assert.equal((await ctx.adminData.getOrder(own.id, boss)).selfDrive, true);

  const user = await ctx.adminData.getUser(dispatcher);
  assert.equal(user.paymentMethods, 0);
  assert.equal(user.profilePage, null);
});

test('停用: a suspended user is signed out and cannot sign in until restored', async () => {
  const boss = await superAdmin();
  const user = await ctx.prisma.user.create({ data: { countryCode: '+852', phone: '61234567' } });
  await ctx.developmentLogin.update({ enabled: true, code: '246810' }, 'test');
  await ctx.auth.requestCode({ countryCode: '+852', phone: '61234567' }, undefined);
  const { token } = await ctx.auth.verifyCode({ countryCode: '+852', phone: '61234567', code: '246810' }, undefined);
  assert.ok(await ctx.auth.resolveSession(token));

  const suspended = await ctx.adminData.suspendUser(user.id, { reason: '重複發假單' }, boss);
  assert.ok(suspended.suspendedAt);
  assert.equal(suspended.suspendedReason, '重複發假單');
  assert.equal(await ctx.auth.resolveSession(token), null, 'signed out everywhere');
  await rejectsWith(ctx.adminData.suspendUser(user.id, { reason: 'again' }, boss), 'USER_ALREADY_SUSPENDED');
  await ctx.prisma.verificationCode.deleteMany();
  await ctx.auth.requestCode({ countryCode: '+852', phone: '61234567' }, undefined);
  await rejectsWith(ctx.auth.verifyCode({ countryCode: '+852', phone: '61234567', code: '246810' }, undefined), 'ACCOUNT_SUSPENDED');

  await ctx.adminData.restoreUser(user.id, boss);
  await rejectsWith(ctx.adminData.restoreUser(user.id, boss), 'USER_NOT_SUSPENDED');
  await ctx.prisma.verificationCode.deleteMany();
  await ctx.auth.requestCode({ countryCode: '+852', phone: '61234567' }, undefined);
  assert.ok((await ctx.auth.verifyCode({ countryCode: '+852', phone: '61234567', code: '246810' }, undefined)).token);
  const actions = (await ctx.prisma.adminAuditLog.findMany({ where: { targetId: user.id }, orderBy: { createdAt: 'asc' } })).map((row) => row.action);
  assert.deepEqual(actions, ['user.suspend', 'user.restore']);
});

test('staff cancel an order for its dispatcher and correct a driver\'s details, both on the record', async () => {
  const boss = await superAdmin();
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(order.code, driver);

  const cancelled = await ctx.adminData.cancelOrder(order.id, { reason: '乘客投訴，出單者失聯' }, boss);
  assert.equal(cancelled.status, 'CANCELLED');
  await rejectsWith(ctx.adminData.cancelOrder(order.id, { reason: 'again' }, boss), 'INVALID_ORDER_STATUS');
  const log = await ctx.prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'order.cancel' } });
  assert.deepEqual(log.detail, { reason: '乘客投訴，出單者失聯' });

  const profile = { name: '改名師傅', vehicleOwnership: 'HK' as const, plateType: 'SINGLE' as const, hkPlate: 'XY 999', vehicleType: '埃爾法', hidePlates: false };
  const saved = await ctx.adminData.saveUserProfile(driver, profile, boss);
  assert.equal(saved.profile?.name, '改名師傅');
  assert.equal(saved.profile?.hkPlate, 'XY 999');
  const change = await ctx.prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'user.profile.update' } });
  assert.ok((change.detail as { changed: string[] }).changed.includes('name'));
});

test('sales staff see orders but not passengers', async () => {
  const boss = await superAdmin();
  const dispatcher = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  const sales = { ...boss, role: 'SALES' as const };
  assert.equal((await ctx.adminData.getOrder(order.id, sales)).passenger, null);
  assert.equal((await ctx.adminData.getOrder(order.id, boss)).passenger?.contact, sampleOrder.passengerContact);
  assert.equal(await ctx.prisma.adminAuditLog.count({ where: { action: 'order.viewPassenger' } }), 1);
});
