import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, sampleOrder, seedPlans, setupDatabase, type TestContext, rejectsWith } from '../test/database';

let ctx: TestContext;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 3);
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

test('exactly one of many simultaneous claims wins, and every attempt is recorded', async () => {
  const dispatcher = await createDriver(ctx, '派單師傅');
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  const drivers = await Promise.all(Array.from({ length: 20 }, (_, i) => createDriver(ctx, `司機${i}`)));

  const results = await Promise.all(drivers.map((driver) => ctx.orders.claim(created.code, driver)));

  const winners = results.filter((r) => r.result === 'WON');
  assert.equal(winners.length, 1);
  const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { code: created.code } });
  assert.equal(stored.status, 'ASSIGNED');
  assert.equal(winners[0].order.passengerContact, '+852 9876 5432');
  for (const loser of results.filter((r) => r.result === 'LOST')) {
    assert.equal('passengerContact' in loser.order, false);
  }
  const claims = await ctx.prisma.orderClaim.groupBy({ by: ['result'], _count: true });
  assert.deepEqual(Object.fromEntries(claims.map((c) => [c.result, c._count])), { WON: 1, LOST: 19 });
});

test('claiming again as the winner is harmless', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  assert.equal((await ctx.orders.claim(created.code, driver)).result, 'WON');
  assert.equal((await ctx.orders.claim(created.code, driver)).result, 'WON');
});

test('a dispatcher cannot claim their own order, and a driver needs details first', async () => {
  const dispatcher = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  await rejectsWith(ctx.orders.claim(created.code, dispatcher), 'CANNOT_CLAIM_OWN_ORDER');

  const newcomer = await ctx.prisma.user.create({ data: { countryCode: '+86', phone: '13800000000' } });
  await rejectsWith(ctx.orders.claim(created.code, newcomer.id), 'PROFILE_REQUIRED');
});

test('the monthly quota stops order creation, even under concurrent requests', async () => {
  const dispatcher = await createDriver(ctx);
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => ctx.orders.create(dispatcher, sampleOrder)));
  assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 3);
  for (const failure of attempts.filter((a) => a.status === 'rejected')) {
    assert.match(String((failure as PromiseRejectedResult).reason?.response?.code), /QUOTA_EXCEEDED/);
  }
  assert.equal(await ctx.prisma.order.count(), 3);
});

test('the launch free period lifts the quota', async () => {
  await ctx.prisma.billingPolicy.create({ data: { name: '上線全站免費期', planKey: 'company', startsAt: new Date(0) } });
  const dispatcher = await createDriver(ctx);
  for (let i = 0; i < 5; i += 1) await ctx.orders.create(dispatcher, sampleOrder);
  assert.equal(await ctx.prisma.order.count(), 5);
});

test('reopening frees the order for another driver; cancelling ends it', async () => {
  const dispatcher = await createDriver(ctx);
  const first = await createDriver(ctx);
  const second = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(created.code, first);

  await rejectsWith(ctx.orders.reopen(first, created.id), 'ORDER_NOT_FOUND');
  const reopened = await ctx.orders.reopen(dispatcher, created.id);
  assert.equal(reopened.status, 'OPEN');
  assert.equal((await ctx.orders.claim(created.code, second)).result, 'WON');

  const cancelled = await ctx.orders.cancel(dispatcher, created.id);
  assert.equal(cancelled.status, 'CANCELLED');
  assert.equal((await ctx.orders.claim(created.code, first)).result, 'LOST');
  await rejectsWith(ctx.orders.cancel(dispatcher, created.id), 'INVALID_ORDER_STATUS');
});

test('the passenger confirms once, sees the driver, and cannot confirm a cancelled order', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx, '李師傅');
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  const confirmCode = created.links.passengerConfirm.split('/c/')[1];

  assert.equal((await ctx.orders.getForPassenger(confirmCode)).driver, null);
  await ctx.orders.claim(created.code, driver);
  const confirmed = await ctx.orders.confirmByPassenger(confirmCode);
  assert.equal(confirmed.driver?.name, '李師傅');
  assert.ok(confirmed.passengerConfirmedAt);
  const again = await ctx.orders.confirmByPassenger(confirmCode);
  assert.equal(again.passengerConfirmedAt, confirmed.passengerConfirmedAt);

  await ctx.orders.cancel(dispatcher, created.id);
  await rejectsWith(ctx.orders.confirmByPassenger(confirmCode), 'INVALID_ORDER_STATUS');
});

test('the dispatcher controls both prices; the driver price locks once claimed', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, {
    ...sampleOrder,
    driverPrice: { amount: 850, currency: 'HKD' as const },
    passengerPrice: { amount: 1000, currency: 'HKD' as const },
  });
  assert.deepEqual(created.margin, { amount: 150, currency: 'HKD' });
  const confirmCode = created.links.passengerConfirm.split('/c/')[1];
  assert.equal((await ctx.orders.getForPassenger(confirmCode)).price, null);

  const raised = await ctx.orders.updatePrices(dispatcher, created.id, { driverPrice: { amount: 900, currency: 'HKD' } });
  assert.deepEqual((raised as typeof created).margin, { amount: 100, currency: 'HKD' });

  const claimed = await ctx.orders.claim(created.code, driver);
  assert.deepEqual(claimed.order.driverPrice, { amount: 900, currency: 'HKD' });
  assert.equal('passengerPrice' in claimed.order, false);
  await rejectsWith(
    ctx.orders.updatePrices(dispatcher, created.id, { driverPrice: { amount: 800, currency: 'HKD' } }),
    'DRIVER_PRICE_LOCKED',
  );
  await ctx.orders.updatePrices(dispatcher, created.id, { showPassengerPrice: true });
  assert.deepEqual((await ctx.orders.getForPassenger(confirmCode)).price, { amount: 1000, currency: 'HKD' });
  await rejectsWith(ctx.orders.updatePrices(driver, created.id, { showPassengerPrice: false }), 'ORDER_NOT_FOUND');
});

test('the dispatcher gets ready-to-paste texts, including the claimed message', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx, '李師傅');
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  assert.ok(created.share.dispatch.wechat.includes(`https://md.test/o/${created.code}`));
  assert.ok(!created.share.dispatch.wechat.includes('9876'));
  assert.equal(created.share.claimed, null);

  await ctx.orders.claim(created.code, driver);
  const detail = (await ctx.orders.getForParticipant(dispatcher, created.id)) as typeof created;
  assert.ok(detail.share.claimed?.includes('司機：李師傅'));
});

test('by default the winner sees the passenger contact one hour before pickup, and the dispatcher can change it', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const { contactRevealMinutes: _, ...withoutReveal } = sampleOrder;
  const created = await ctx.orders.create(dispatcher, withoutReveal);
  assert.equal(created.contactRevealMinutes, 60);

  const won = await ctx.orders.claim(created.code, driver);
  assert.equal(won.order.passengerContact, null, 'pickup is days away');
  assert.ok(won.order.contactRevealAt);

  await ctx.orders.setContactReveal(dispatcher, created.id, { contactRevealMinutes: null });
  assert.equal((await ctx.orders.getByCode(created.code, driver)).passengerContact, sampleOrder.passengerContact);
  await rejectsWith(ctx.orders.setContactReveal(driver, created.id, { contactRevealMinutes: 0 }), 'ORDER_NOT_FOUND');
});

test("the dispatcher's own default applies to new orders", async () => {
  const dispatcher = await createDriver(ctx);
  await ctx.prisma.user.update({ where: { id: dispatcher }, data: { contactRevealMinutes: 120 } });
  const { contactRevealMinutes: _, ...withoutReveal } = sampleOrder;
  assert.equal((await ctx.orders.create(dispatcher, withoutReveal)).contactRevealMinutes, 120);
  assert.equal((await ctx.orders.create(dispatcher, { ...withoutReveal, contactRevealMinutes: 30 })).contactRevealMinutes, 30);
});
