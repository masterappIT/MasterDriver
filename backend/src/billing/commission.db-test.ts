import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, rejectsWith, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';
import { COMMISSION_EXEMPT_FEATURE } from './commission.service';

let ctx: TestContext;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 100);
  await ctx.prisma.feature.create({ data: { key: COMMISSION_EXEMPT_FEATURE, name: '免平台服務費', kind: 'SWITCH' } });
  await ctx.prisma.planFeature.create({ data: { planKey: 'company', featureKey: COMMISSION_EXEMPT_FEATURE } });
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

const balanceOf = async (userId: string) =>
  (await ctx.prisma.creditAccount.findUnique({ where: { userId } }))?.balanceMinor ?? 0;
const topUp = (userId: string, dollars: number) =>
  ctx.credits.credit(userId, dollars * 100, { type: 'TOPUP', source: 'MANUAL', createdBy: 'test' });

test('with the service fee switched off, orders cost nothing', async () => {
  const dispatcher = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  assert.equal(created.serviceFee, null);
  assert.equal(await ctx.prisma.creditEntry.count(), 0);
});

test('with the fee on, an order needs credits; without them nothing is created and no quota is used', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  await rejectsWith(ctx.orders.create(dispatcher, sampleOrder), 'INSUFFICIENT_CREDITS');
  assert.equal(await ctx.prisma.order.count(), 0);
  assert.equal(await ctx.prisma.usage.count(), 0);
});

test('the fee is charged to the dispatcher only, and returned once when the order is cancelled', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  await topUp(dispatcher, 20);

  const created = await ctx.orders.create(dispatcher, sampleOrder);
  assert.equal(created.serviceFee, 5);
  assert.equal(await balanceOf(dispatcher), 1500);

  await ctx.orders.claim(created.code, driver);
  assert.equal(await balanceOf(driver), 0);
  assert.equal(await ctx.prisma.creditEntry.count({ where: { userId: driver } }), 0);

  await ctx.orders.cancel(dispatcher, created.id);
  assert.equal(await balanceOf(dispatcher), 2000);
  const entries = await ctx.prisma.creditEntry.findMany({ where: { userId: dispatcher }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(
    entries.map((e) => [e.type, e.amountMinor, e.balanceAfterMinor]),
    [
      ['TOPUP', 2000, 2000],
      ['CHARGE', -500, 1500],
      ['REFUND', 500, 2000],
    ],
  );
});

test('concurrent orders never spend more credits than the balance', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  await topUp(dispatcher, 10);
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => ctx.orders.create(dispatcher, sampleOrder)));
  assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 2);
  assert.equal(await balanceOf(dispatcher), 0);
  assert.equal(await ctx.prisma.order.count(), 2);
});

test('subscribers and everyone during the launch free period pay no fee', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const subscriber = await createDriver(ctx);
  await ctx.prisma.subscription.create({
    data: { userId: subscriber, planKey: 'company', source: 'MANUAL', startsAt: new Date(0) },
  });
  assert.equal((await ctx.orders.create(subscriber, sampleOrder)).serviceFee, null);

  const everyone = await createDriver(ctx);
  await rejectsWith(ctx.orders.create(everyone, sampleOrder), 'INSUFFICIENT_CREDITS');
  await ctx.prisma.billingPolicy.create({ data: { name: '上線全站免費期', planKey: 'company', startsAt: new Date(0) } });
  assert.equal((await ctx.orders.create(everyone, sampleOrder)).serviceFee, null);
  assert.deepEqual(await ctx.commission.forUser(everyone), {
    enabled: true,
    feePerOrder: { amount: 0, currency: 'HKD' },
    exempt: true,
  });
});

test('a manual correction cannot push a balance below zero', async () => {
  const dispatcher = await createDriver(ctx);
  await topUp(dispatcher, 3);
  await rejectsWith(
    ctx.credits.credit(dispatcher, -400, { type: 'ADJUST', note: 'too much', createdBy: 'test' }),
    'BALANCE_WOULD_BE_NEGATIVE',
  );
  await ctx.credits.credit(dispatcher, -300, { type: 'ADJUST', note: 'refund to customer', createdBy: 'test' });
  assert.equal(await balanceOf(dispatcher), 0);
});
