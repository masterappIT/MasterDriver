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

test('the claim page counts the trips its dispatcher took and finished, not the ones they dispatched', async () => {
  const dispatcher = await createDriver(ctx);
  const other = await createDriver(ctx);
  const own = await ctx.orders.create(dispatcher, sampleOrder);
  assert.equal((await ctx.orders.getByCode(own.code)).dispatcherCompletedTrips, 0);

  // A trip the dispatcher dispatched and someone else finished does not count for the dispatcher.
  assert.equal((await ctx.orders.claim(own.code, other)).result, 'WON');
  await ctx.orders.complete(other, own.id);
  // A trip the dispatcher took from someone else and finished does.
  const taken = await ctx.orders.create(other, sampleOrder);
  assert.equal((await ctx.orders.claim(taken.code, dispatcher)).result, 'WON');
  const claimedOnly = await ctx.orders.getByCode(own.code);
  assert.equal(claimedOnly.dispatcherCompletedTrips, 0, 'claimed is not completed');
  await ctx.orders.complete(dispatcher, taken.id);

  const view = await ctx.orders.getByCode(own.code);
  assert.equal(view.dispatcherCompletedTrips, 1);
  assert.equal((await ctx.orders.claim(own.code, other)).order.dispatcherCompletedTrips, 1, 'the claim result carries it too');
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

test('the one-line text the order was written from is kept with the order', async () => {
  const dispatcher = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, { ...sampleOrder, rawText: '明天15:40澳门送惠州博罗湾，直车 7座' });
  const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.rawText, '明天15:40澳门送惠州博罗湾，直车 7座');
});

// 接駁: one trip, several legs, each its own order.

const macauLeg = {
  ...sampleOrder,
  pickupAt: '2026-10-15T16:00:00+08:00',
  origin: '港珠澳大橋澳門口岸',
  destination: '澳門威尼斯人',
  requiredPlates: ['MACAU' as const],
};

const balanceOf = async (userId: string) =>
  (await ctx.prisma.creditAccount.findUniqueOrThrow({ where: { userId } })).balanceMinor;

test('a following leg joins the trip and uses neither quota nor service fee again', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  await ctx.credits.credit(dispatcher, 2000, { type: 'TOPUP', source: 'MANUAL', createdBy: 'test' });

  const first = await ctx.orders.create(dispatcher, { ...sampleOrder, destination: '港珠澳大橋香港口岸' });
  const second = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: first.id });

  assert.equal(await balanceOf(dispatcher), 1500, 'charged once for the trip');
  assert.equal(second.serviceFee, null);
  const usage = await ctx.prisma.usage.findMany({ where: { userId: dispatcher } });
  assert.equal(usage.reduce((sum, row) => sum + row.used, 0), 1, 'one order of quota for the trip');

  assert.equal(second.journey?.legIndex, 2);
  assert.equal(second.journey?.legCount, 2);
  assert.deepEqual(second.journey?.legs.map((leg) => leg.origin), ['深圳灣口岸', '港珠澳大橋澳門口岸']);
  assert.ok(second.share.dispatch.wechat.includes('接駁：第 2／2 段'));
  assert.ok(second.share.dispatch.wechat.includes('接駁位置：港珠澳大橋澳門口岸'));
  assert.ok(second.share.dispatch.wechat.includes('需澳門車'));
  assert.deepEqual(second.requiredPlates, ['MACAU']);
  const firstConfirm = first.links.passengerConfirm;
  assert.ok(second.share.passenger.includes(firstConfirm), 'the passenger gets the first leg link');
  assert.ok(second.share.passenger.includes('深圳灣口岸 → 澳門威尼斯人（2 段接駁）'));
});

test('a leg only follows the last leg, not before it, and a trip has at most four legs', async () => {
  const dispatcher = await createDriver(ctx);
  const other = await createDriver(ctx);
  await ctx.prisma.billingPolicy.create({ data: { name: '上線全站免費期', planKey: 'company', startsAt: new Date(0) } });
  const first = await ctx.orders.create(dispatcher, sampleOrder);

  await rejectsWith(ctx.orders.create(other, { ...macauLeg, afterOrderId: first.id }), 'ORDER_NOT_FOUND');
  await rejectsWith(
    ctx.orders.create(dispatcher, { ...macauLeg, pickupAt: '2026-10-15T13:00:00+08:00', afterOrderId: first.id }),
    'LEG_BEFORE_PREVIOUS',
  );

  let last = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: first.id });
  await rejectsWith(ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: first.id }), 'NOT_LAST_LEG');
  last = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: last.id });
  last = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: last.id });
  assert.equal(last.journey?.legIndex, 4);
  await rejectsWith(ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: last.id }), 'JOURNEY_LEG_LIMIT');
});

test('two legs added at once to the same order: one wins, the other is told it is not the last leg', async () => {
  const dispatcher = await createDriver(ctx);
  await ctx.prisma.billingPolicy.create({ data: { name: '上線全站免費期', planKey: 'company', startsAt: new Date(0) } });
  const first = await ctx.orders.create(dispatcher, sampleOrder);
  const attempts = await Promise.allSettled(
    Array.from({ length: 3 }, () => ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: first.id })),
  );
  assert.equal(attempts.filter((a) => a.status === 'fulfilled').length, 1);
  assert.equal(await ctx.prisma.order.count({ where: { journeyId: first.id } }), 2);
});

test('the trip fee returns only when every leg is cancelled, even when legs are cancelled together', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  await ctx.credits.credit(dispatcher, 2000, { type: 'TOPUP', source: 'MANUAL', createdBy: 'test' });
  const first = await ctx.orders.create(dispatcher, sampleOrder);
  const second = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: first.id });

  await ctx.orders.cancel(dispatcher, first.id);
  assert.equal(await balanceOf(dispatcher), 1500, 'the second leg is still on');
  const stillOn = await ctx.prisma.order.findUniqueOrThrow({ where: { id: second.id } });
  assert.equal(stillOn.status, 'OPEN', 'other legs are never cancelled automatically');
  await ctx.orders.cancel(dispatcher, second.id);
  assert.equal(await balanceOf(dispatcher), 2000);

  const a = await ctx.orders.create(dispatcher, sampleOrder);
  const b = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: a.id });
  await Promise.all([ctx.orders.cancel(dispatcher, a.id), ctx.orders.cancel(dispatcher, b.id)]);
  assert.equal(await balanceOf(dispatcher), 2000, 'refunded exactly once');
  assert.equal(await ctx.prisma.creditEntry.count({ where: { userId: dispatcher, type: 'REFUND' } }), 2);
});

test('the passenger sees every leg with its driver and confirms the whole trip once', async () => {
  const dispatcher = await createDriver(ctx, '派單師傅');
  const hkDriver = await createDriver(ctx, '香港師傅');
  const macauDriver = await createDriver(ctx, '澳門師傅');
  const first = await ctx.orders.create(dispatcher, { ...sampleOrder, destination: '港珠澳大橋香港口岸' });
  const second = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: first.id });
  const confirmCode = first.links.passengerConfirm.split('/c/')[1];

  await ctx.orders.claim(first.code, hkDriver);
  let trip = await ctx.orders.getForPassenger(confirmCode);
  assert.equal(trip.status, 'OPEN', 'the Macau leg has no driver yet');
  assert.equal(trip.destination, '澳門威尼斯人');
  assert.deepEqual(trip.legs?.map((leg) => leg.driver?.name ?? null), ['香港師傅', null]);
  assert.equal(trip.legs?.[1].origin, '港珠澳大橋澳門口岸');

  await ctx.orders.claim(second.code, macauDriver);
  trip = await ctx.orders.confirmByPassenger(confirmCode);
  assert.equal(trip.status, 'ASSIGNED');
  assert.ok(trip.passengerConfirmedAt);
  const stored = await ctx.prisma.order.findMany({ where: { journeyId: first.id } });
  assert.ok(stored.every((leg) => leg.passengerConfirmedAt));

  // Each leg's driver sees the other leg's driver; the phone follows this leg's reveal time.
  const hkView = await ctx.orders.getByCode(first.code, hkDriver);
  const macauOnHk = hkView.journey?.legs[1];
  assert.equal(macauOnHk?.driver?.name, '澳門師傅');
  assert.ok(macauOnHk?.driver?.phone, 'sampleOrder reveals contacts at once');
  // Drivers who did not win see the route of each leg but no driver.
  const outsider = await createDriver(ctx);
  const outsiderView = await ctx.orders.getByCode(second.code, outsider);
  assert.equal(outsiderView.journey?.legs[0].origin, '深圳灣口岸');
  assert.equal('driver' in (outsiderView.journey?.legs[0] ?? {}), false);
});

test('接駁 chosen when dispatching: the order is leg 1 of a trip before the next leg exists', async () => {
  const dispatcher = await createDriver(ctx);
  const first = await ctx.orders.create(dispatcher, { ...sampleOrder, destination: '港珠澳大橋香港口岸', transfer: true });

  assert.equal(first.journey?.legIndex, 1);
  assert.equal(first.journey?.legCount, 1);
  assert.deepEqual(first.journey?.transferPlaces, ['港珠澳大橋香港口岸']);
  assert.ok(first.share.dispatch.wechat.includes('接駁：第 1 段'));
  assert.ok(first.share.dispatch.wechat.includes('接駁位置：港珠澳大橋香港口岸'));
  assert.ok(!first.share.passenger.includes('段接駁'), 'one leg reads like a single order to the passenger');
  const direct = await ctx.orders.create(dispatcher, sampleOrder);
  assert.equal(direct.journey, null);

  const second = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: first.id });
  assert.equal(second.journey?.legCount, 2);
  assert.equal(await ctx.prisma.order.count({ where: { journeyId: first.id } }), 2);
});

test('the transfer place is shared: a new leg moves the previous destination unless another driver holds that leg', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  await ctx.prisma.billingPolicy.create({ data: { name: '上線全站免費期', planKey: 'company', startsAt: new Date(0) } });
  const destinationOf = async (id: string) => (await ctx.prisma.order.findUniqueOrThrow({ where: { id } })).destination;

  const open = await ctx.orders.create(dispatcher, { ...sampleOrder, transfer: true });
  const next = await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: open.id });
  assert.equal(await destinationOf(open.id), '港珠澳大橋澳門口岸');
  assert.deepEqual(next.journey?.legs.map((leg) => leg.destination), ['港珠澳大橋澳門口岸', '澳門威尼斯人']);

  const own = await ctx.orders.create(dispatcher, { ...sampleOrder, transfer: true, selfDrive: true });
  await ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: own.id });
  assert.equal(await destinationOf(own.id), '港珠澳大橋澳門口岸', 'the dispatcher drives it, so nobody else agreed to the old place');

  const claimed = await ctx.orders.create(dispatcher, { ...sampleOrder, transfer: true });
  await ctx.orders.claim(claimed.code, driver);
  await rejectsWith(ctx.orders.create(dispatcher, { ...macauLeg, afterOrderId: claimed.id }), 'TRANSFER_PLACE_LOCKED');
  assert.equal(await destinationOf(claimed.id), '香港國際機場');
  assert.equal(await ctx.prisma.order.count({ where: { journeyId: claimed.id } }), 1, 'the rejected leg left nothing behind');
  const same = await ctx.orders.create(dispatcher, { ...macauLeg, origin: '香港國際機場', afterOrderId: claimed.id });
  assert.equal(same.journey?.legCount, 2);
});

test("the other leg's driver phone waits for this leg's reveal time", async () => {
  const dispatcher = await createDriver(ctx);
  const hkDriver = await createDriver(ctx, '香港師傅');
  const macauDriver = await createDriver(ctx, '澳門師傅');
  const first = await ctx.orders.create(dispatcher, { ...sampleOrder, contactRevealMinutes: 60 });
  const second = await ctx.orders.create(dispatcher, { ...macauLeg, contactRevealMinutes: 60, afterOrderId: first.id });
  await ctx.orders.claim(first.code, hkDriver);
  await ctx.orders.claim(second.code, macauDriver);

  const hkView = await ctx.orders.getByCode(first.code, hkDriver);
  assert.equal(hkView.journey?.legs[1].driver?.name, '澳門師傅');
  assert.equal(hkView.journey?.legs[1].driver?.phone, null, 'pickup is days away');
  const dispatcherView = await ctx.orders.getByCode(first.code, dispatcher);
  assert.ok(dispatcherView.journey?.legs[1].driver?.phone);
});

test('這段我自己做: the dispatcher drives the leg, nobody can claim it, and 改派 offers it to the group', async () => {
  const dispatcher = await createDriver(ctx, '派單師傅');
  const driver = await createDriver(ctx);
  const own = await ctx.orders.create(dispatcher, { ...sampleOrder, selfDrive: true });
  assert.equal(own.status, 'ASSIGNED');
  assert.equal(own.selfDrive, true);
  assert.equal(own.driver?.name, '派單師傅');
  assert.equal((await ctx.orders.claim(own.code, driver)).result, 'LOST');

  const reopened = await ctx.orders.reopen(dispatcher, own.id);
  assert.equal(reopened.status, 'OPEN');
  assert.equal((await ctx.orders.claim(own.code, driver)).result, 'WON');

  const newcomer = await ctx.prisma.user.create({ data: { countryCode: '+86', phone: '13800000001' } });
  await rejectsWith(ctx.orders.create(newcomer.id, { ...sampleOrder, selfDrive: true }), 'PROFILE_REQUIRED');
});

const BEFORE_PICKUP = new Date('2026-10-14T09:00:00+08:00');

test('接單池 lists only orders their dispatcher ticked, to drivers with details, without passenger details', async () => {
  const dispatcher = await createDriver(ctx, '派單師傅');
  const driver = await createDriver(ctx);
  await ctx.orders.create(dispatcher, sampleOrder);
  const listed = await ctx.orders.create(dispatcher, { ...sampleOrder, inPool: true, passengerName: '陳先生' });
  assert.equal(listed.inPool, true);

  const pool = await ctx.orders.pool(driver, {}, BEFORE_PICKUP);
  assert.deepEqual(pool.map((order) => order.code), [listed.code]);
  assert.equal(pool[0].viewer, 'other');
  assert.equal(pool[0].dispatcherName, '派單師傅');
  for (const hidden of ['id', 'passengerName', 'passengerContact', 'dispatcherPhone', 'passengerPrice', 'links']) {
    assert.equal(hidden in pool[0], false, hidden);
  }

  // Their own orders are in 我的單, not in the pool they claim from.
  assert.deepEqual(await ctx.orders.pool(dispatcher, {}, BEFORE_PICKUP), []);

  const newcomer = await ctx.prisma.user.create({ data: { countryCode: '+86', phone: '13800000001' } });
  await rejectsWith(ctx.orders.pool(newcomer.id, {}, BEFORE_PICKUP), 'PROFILE_REQUIRED');
});

test('an order leaves the 接單池 when claimed, taken out, cancelled or past its time, and returns when reopened', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const viewer = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, { ...sampleOrder, inPool: true });
  const codes = async (now = BEFORE_PICKUP) => (await ctx.orders.pool(viewer, {}, now)).map((order) => order.code);

  assert.deepEqual(await codes(), [created.code]);
  assert.deepEqual(await codes(new Date('2026-10-15T14:31:00+08:00')), []);

  await ctx.orders.claim(created.code, driver);
  assert.deepEqual(await codes(), []);
  await rejectsWith(ctx.orders.setPool(dispatcher, created.id, { inPool: false }), 'INVALID_ORDER_STATUS');
  await ctx.orders.reopen(dispatcher, created.id);
  assert.deepEqual(await codes(), [created.code]);

  await rejectsWith(ctx.orders.setPool(driver, created.id, { inPool: false }), 'ORDER_NOT_FOUND');
  assert.equal((await ctx.orders.setPool(dispatcher, created.id, { inPool: false })).inPool, false);
  assert.deepEqual(await codes(), []);
  await ctx.orders.setPool(dispatcher, created.id, { inPool: true });
  await ctx.orders.cancel(dispatcher, created.id);
  assert.deepEqual(await codes(), []);
});

test('the 接單池 default comes from the dispatcher, and 這段我自己做 never enters it', async () => {
  const dispatcher = await createDriver(ctx);
  const viewer = await createDriver(ctx);
  await ctx.prisma.user.update({ where: { id: dispatcher }, data: { poolByDefault: true } });

  const byDefault = await ctx.orders.create(dispatcher, sampleOrder);
  const optedOut = await ctx.orders.create(dispatcher, { ...sampleOrder, inPool: false });
  const own = await ctx.orders.create(dispatcher, { ...sampleOrder, selfDrive: true, inPool: true });
  assert.equal(byDefault.inPool, true);
  assert.equal(optedOut.inPool, false);
  assert.equal(own.inPool, false);
  assert.deepEqual((await ctx.orders.pool(viewer, {}, BEFORE_PICKUP)).map((order) => order.code), [byDefault.code]);
});

test('the 接單池 filters by Hong Kong day and by a word in the origin or destination, soonest first', async () => {
  const dispatcher = await createDriver(ctx);
  const viewer = await createDriver(ctx);
  const later = await ctx.orders.create(dispatcher, { ...sampleOrder, inPool: true, pickupAt: '2026-10-16T00:30:00+08:00', destination: '澳門機場' });
  const sooner = await ctx.orders.create(dispatcher, { ...sampleOrder, inPool: true, pickupAt: '2026-10-15T23:30:00+08:00' });
  const codes = async (query: { date?: string; q?: string }) => (await ctx.orders.pool(viewer, query, BEFORE_PICKUP)).map((order) => order.code);

  assert.deepEqual(await codes({}), [sooner.code, later.code]);
  assert.deepEqual(await codes({ date: '2026-10-15' }), [sooner.code]);
  assert.deepEqual(await codes({ date: '2026-10-16' }), [later.code]);
  assert.deepEqual(await codes({ q: '澳門' }), [later.code]);
  assert.deepEqual(await codes({ q: '深圳灣' }), [sooner.code, later.code]);
  assert.deepEqual(await codes({ date: '2026-10-15', q: '澳門' }), []);
});
