import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, daysFromNow, sampleOrder, seedPlans, setupDatabase, type TestContext, rejectsWith } from '../test/database';

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
  const created = await ctx.orders.create(dispatcher, { ...withoutReveal, pickupAt: daysFromNow(3) });
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
  const created = await ctx.orders.create(dispatcher, { ...sampleOrder, rawText: '明天15:40澳门送香港，直车 7座' });
  const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.rawText, '明天15:40澳门送香港，直车 7座');
});

// 接駁: one order in two legs, each taken by its own driver, meeting at the 接駁位置.

const transferOrder = {
  ...sampleOrder,
  origin: '香港',
  destination: '廣州',
  vehicleType: '7座',
  driverPrice: { amount: 400, currency: 'HKD' as const },
  passengerPrice: { amount: 1500, currency: 'HKD' as const },
  showPassengerPrice: true,
  transfer: {
    place: '深圳灣口岸',
    pickupAt: '2026-10-15T16:00:00+08:00',
    driverPrice: { amount: 600, currency: 'CNY' as const },
    requiredPlates: ['MAINLAND' as const],
    selfDriveLeg: null,
  },
};

const balanceOf = async (userId: string) =>
  (await ctx.prisma.creditAccount.findUniqueOrThrow({ where: { userId } })).balanceMinor;
const freeForAll = () => ctx.prisma.billingPolicy.create({ data: { name: '上線全站免費期', planKey: 'company', startsAt: new Date(0) } });

test('a 接駁 order is one order in two legs: quota and fee once, one group text, one link', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  await ctx.credits.credit(dispatcher, 2000, { type: 'TOPUP', source: 'MANUAL', createdBy: 'test' });

  const order = await ctx.orders.create(dispatcher, transferOrder);

  assert.equal(await balanceOf(dispatcher), 1500, 'charged once');
  const usage = await ctx.prisma.usage.findMany({ where: { userId: dispatcher } });
  assert.equal(usage.reduce((sum, row) => sum + row.used, 0), 1, 'one order of quota');
  assert.equal(order.journey?.legCount, 2);
  assert.equal(order.journey?.origin, '香港');
  assert.equal(order.journey?.destination, '廣州');
  assert.deepEqual(order.journey?.legs.map((leg) => `${leg.origin}→${leg.destination}`), ['香港→深圳灣口岸', '深圳灣口岸→廣州']);
  const stored = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(stored.map((leg) => leg.passengerPriceMinor), [150000, null], 'one passenger price, on the first leg');
  assert.deepEqual(stored.map((leg) => leg.requiredPlates), [[], ['MAINLAND']]);
  assert.deepEqual(stored.map((leg) => leg.driverPriceMinor), [40000, 60000]);

  assert.equal(order.margin, null, 'HKD passenger price against an RMB leg: no spread');
  const sameCurrency = await ctx.orders.create(dispatcher, { ...transferOrder, transfer: { ...transferOrder.transfer, driverPrice: { amount: 600, currency: 'HKD' } } });
  assert.deepEqual(sameCurrency.margin, { amount: 500, currency: 'HKD' }, 'the one passenger price against both legs');

  const text = order.share.dispatch.wechat;
  assert.ok(text.startsWith('【有單・接駁】10/15（四）14:30'));
  assert.ok(text.includes('香港 → 深圳灣口岸（換車）→ 廣州'));
  assert.ok(text.includes('第 1 段：10/15（四）14:30 香港 → 深圳灣口岸｜HK$400'));
  assert.ok(text.includes('第 2 段：10/15（四）16:00 深圳灣口岸 → 廣州｜需內地車｜RMB¥600'));
  assert.ok(text.endsWith(`搶單（選一段）：${order.links.dispatch}`), 'one link, the first leg\'s');
  assert.ok(order.share.passenger.includes('香港 → 廣州（接駁，中途換車）'));
  assert.ok(order.share.passenger.includes('HK$1,500'));
  assert.ok(!order.share.passenger.includes('深圳灣口岸'), 'the passenger is not told where the cars meet');
});

test('the second leg cannot start before the first, and nothing is created then', async () => {
  const dispatcher = await createDriver(ctx);
  await rejectsWith(
    ctx.orders.create(dispatcher, { ...transferOrder, transfer: { ...transferOrder.transfer, pickupAt: '2026-10-15T13:00:00+08:00' } }),
    'LEG_BEFORE_PREVIOUS',
  );
  assert.equal(await ctx.prisma.order.count(), 0);
  assert.equal((await ctx.prisma.usage.findMany({ where: { userId: dispatcher } })).reduce((sum, row) => sum + row.used, 0), 0);
});

test('the one link offers both legs; a driver takes one leg only, even with two taps at once', async () => {
  const dispatcher = await createDriver(ctx);
  const [b, c, d] = await Promise.all(['B', 'C', 'D'].map((name) => createDriver(ctx, name)));
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, transferOrder);

  const offered = await ctx.orders.getByCode(order.code, b);
  const [first, second] = offered.journey!.legs;
  assert.equal(first.code, order.code);
  assert.notEqual(second.code, order.code);
  assert.equal(second.status, 'OPEN');
  assert.equal('driver' in second, false, 'no drivers before taking a leg');

  assert.equal((await ctx.orders.claim(first.code, b)).result, 'WON');
  await rejectsWith(ctx.orders.claim(second.code, b), 'ONE_LEG_PER_DRIVER');
  assert.equal((await ctx.orders.claim(second.code, c)).result, 'WON');
  const seenByC = await ctx.orders.getByCode(order.code, c);
  assert.deepEqual(seenByC.journey?.legs.map((leg) => leg.mine), [false, true], 'the first leg\'s link shows C which leg is theirs');
  assert.equal((await ctx.orders.getByCode(second.code, c)).journey?.legs[0].driver?.name, 'B', 'on their own leg, C sees the other driver');

  const again = await ctx.orders.create(dispatcher, transferOrder);
  const legs = (await ctx.orders.getByCode(again.code, d)).journey!.legs;
  const taps = await Promise.allSettled(legs.map((leg) => ctx.orders.claim(leg.code, d)));
  assert.equal(taps.filter((tap) => tap.status === 'fulfilled' && tap.value.result === 'WON').length, 1);
  assert.equal(await ctx.prisma.order.count({ where: { journeyId: again.id, claimedById: d } }), 1);
});

test('the dispatcher may drive one leg; the other goes to the group', async () => {
  const dispatcher = await createDriver(ctx);
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, { ...transferOrder, transfer: { ...transferOrder.transfer, selfDriveLeg: 2 } });
  const [first, second] = order.journey!.legs;
  assert.equal(second.status, 'ASSIGNED');
  assert.equal(second.selfDrive, true);
  assert.equal(first.status, 'OPEN');
  assert.ok(order.share.dispatch.wechat.includes('第 2 段：10/15（四）16:00 深圳灣口岸 → 廣州｜出單者自己開'));
  await rejectsWith(ctx.orders.claim(first.code, dispatcher), 'CANNOT_CLAIM_OWN_ORDER');
});

test('cancelling from either leg cancels the whole order and returns the fee once; 改派 reopens one leg', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  await ctx.credits.credit(dispatcher, 2000, { type: 'TOPUP', source: 'MANUAL', createdBy: 'test' });
  const order = await ctx.orders.create(dispatcher, transferOrder);
  const legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  await ctx.orders.claim(legs[0].code, driver);

  await ctx.orders.reopen(dispatcher, legs[0].id);
  const reopened = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(reopened.map((leg) => leg.status), ['OPEN', 'OPEN']);
  await ctx.orders.claim(legs[0].code, driver);

  await ctx.orders.cancel(dispatcher, legs[1].id);
  const after = await ctx.prisma.order.findMany({ where: { journeyId: order.id } });
  assert.ok(after.every((leg) => leg.status === 'CANCELLED'));
  assert.equal(await balanceOf(dispatcher), 2000);
  const told = await ctx.prisma.notification.findMany({ where: { userId: driver, kind: 'ORDER_CANCELLED' } });
  assert.equal(told.length, 1, 'the driver of the first leg is told');
  await rejectsWith(ctx.orders.cancel(dispatcher, legs[0].id), 'INVALID_ORDER_STATUS');

  const both = await ctx.orders.create(dispatcher, transferOrder);
  const pair = await ctx.prisma.order.findMany({ where: { journeyId: both.id } });
  const cancels = await Promise.allSettled(pair.map((leg) => ctx.orders.cancel(dispatcher, leg.id)));
  assert.equal(cancels.filter((one) => one.status === 'fulfilled').length, 1);
  assert.equal(await balanceOf(dispatcher), 2000, 'refunded exactly once');
  assert.equal(await ctx.prisma.creditEntry.count({ where: { userId: dispatcher, type: 'REFUND' } }), 2);
});

test('取消接單: the driver gives the order back, it is open again, and the dispatcher is told', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const other = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(created.code, driver);
  await ctx.orders.confirmByPassenger(created.links.passengerConfirm.split('/c/')[1]);

  await rejectsWith(ctx.orders.release(other, created.id), 'ORDER_NOT_FOUND');
  await rejectsWith(ctx.orders.release(dispatcher, created.id), 'ORDER_NOT_FOUND'); // the dispatcher uses 改派
  const released = await ctx.orders.release(driver, created.id);
  assert.equal(released.status, 'OPEN');
  const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.id } });
  assert.deepEqual([stored.claimedById, stored.claimedAt, stored.passengerConfirmedAt], [null, null, null]);
  assert.equal(await ctx.prisma.notification.count({ where: { userId: dispatcher, kind: 'ORDER_RELEASED', orderId: created.id } }), 1);
  await rejectsWith(ctx.orders.release(driver, created.id), 'ORDER_NOT_FOUND'); // no longer theirs
  assert.equal((await ctx.orders.claim(created.code, other)).result, 'WON', 'the same link is open to claim');

  await ctx.orders.complete(other, created.id);
  await rejectsWith(ctx.orders.release(other, created.id), 'INVALID_ORDER_STATUS'); // not once the trip is done

  const own = await ctx.orders.create(dispatcher, { ...sampleOrder, selfDrive: true });
  await rejectsWith(ctx.orders.release(dispatcher, own.id), 'INVALID_ORDER_STATUS'); // 這單我自己做 is handed over with 交給別的司機
});

test('取消接單 on a 接駁 order gives back only that leg; the other leg and the order go on', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  const hkDriver = await createDriver(ctx);
  const mainlandDriver = await createDriver(ctx);
  await ctx.credits.credit(dispatcher, 2000, { type: 'TOPUP', source: 'MANUAL', createdBy: 'test' });
  const order = await ctx.orders.create(dispatcher, transferOrder);
  const [first, second] = order.journey!.legs;
  await ctx.orders.claim(first.code, hkDriver);
  await ctx.orders.claim(second.code, mainlandDriver);
  const legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });

  const released = await ctx.orders.release(mainlandDriver, legs[1].id);
  assert.equal(released.status, 'OPEN');
  const after = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(after.map((leg) => [leg.status, leg.claimedById]), [['ASSIGNED', hkDriver], ['OPEN', null]]);
  assert.equal(await balanceOf(dispatcher), 1500, 'the fee stays: the order goes on');
  assert.equal(await ctx.prisma.notification.count({ where: { userId: dispatcher, kind: 'ORDER_RELEASED' } }), 1);
  assert.equal(await ctx.prisma.notification.count({ where: { userId: hkDriver } }), 0, 'the other leg is not disturbed');

  await rejectsWith(ctx.orders.claim(second.code, hkDriver), 'ONE_LEG_PER_DRIVER');
  assert.equal((await ctx.orders.claim(second.code, mainlandDriver)).result, 'WON', 'the leg can be taken again');
});

test('the passenger sees one trip, one price and two drivers, never where the cars meet', async () => {
  const dispatcher = await createDriver(ctx, '派單師傅');
  const hkDriver = await createDriver(ctx, '香港師傅');
  const mainlandDriver = await createDriver(ctx, '內地師傅');
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, transferOrder);
  const [first, second] = order.journey!.legs;
  const confirmCode = order.links.passengerConfirm.split('/c/')[1];

  await ctx.orders.claim(first.code, hkDriver);
  let trip = await ctx.orders.getForPassenger(confirmCode);
  assert.equal(trip.status, 'OPEN', 'the second leg has no driver yet');
  assert.equal(trip.transfer, true);
  assert.equal(trip.origin, '香港');
  assert.equal(trip.destination, '廣州');
  assert.deepEqual(trip.price, { amount: 1500, currency: 'HKD' });
  assert.deepEqual(trip.legs?.map((leg) => leg.driver?.name ?? null), ['香港師傅', null]);
  assert.ok(!JSON.stringify(trip).includes('深圳灣口岸'));

  await ctx.orders.claim(second.code, mainlandDriver);
  trip = await ctx.orders.confirmByPassenger(confirmCode);
  assert.equal(trip.status, 'ASSIGNED');
  assert.ok(trip.passengerConfirmedAt);
  const stored = await ctx.prisma.order.findMany({ where: { journeyId: order.id } });
  assert.ok(stored.every((leg) => leg.passengerConfirmedAt), 'one confirmation for the whole order');
  await rejectsWith(ctx.orders.updatePrices(dispatcher, stored.find((leg) => leg.legIndex === 2)!.id, { passengerPrice: null }), 'TRIP_PRICE_ON_FIRST_LEG');
});

test("the other leg's driver phone waits for this leg's reveal time", async () => {
  const dispatcher = await createDriver(ctx);
  const hkDriver = await createDriver(ctx, '香港師傅');
  const mainlandDriver = await createDriver(ctx, '內地師傅');
  await freeForAll();
  // Both legs days ahead of the real clock, so neither driver's phone is due yet.
  const order = await ctx.orders.create(dispatcher, {
    ...transferOrder,
    pickupAt: daysFromNow(3),
    transfer: { ...transferOrder.transfer, pickupAt: daysFromNow(3.1) },
    contactRevealMinutes: 60,
  });
  const [first, second] = order.journey!.legs;
  await ctx.orders.claim(first.code, hkDriver);
  await ctx.orders.claim(second.code, mainlandDriver);

  const hkView = await ctx.orders.getByCode(first.code, hkDriver);
  assert.equal(hkView.journey?.legs[1].driver?.name, '內地師傅');
  assert.equal(hkView.journey?.legs[1].driver?.phone, null, 'pickup is days away');
  const dispatcherView = await ctx.orders.getByCode(first.code, dispatcher);
  assert.ok(dispatcherView.journey?.legs[1].driver?.phone);
});

test('the 接單池 and the dispatcher\'s list show a 接駁 order once, while either leg is open', async () => {
  const dispatcher = await createDriver(ctx);
  const [b, c, looker] = await Promise.all(['B', 'C', 'L'].map((name) => createDriver(ctx, name)));
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, { ...transferOrder, inPool: true });
  const [first, second] = order.journey!.legs;
  const before = new Date('2026-10-01T00:00:00+08:00');
  const pooled = async (q?: string) => (await ctx.orders.pool(looker, { q }, before)).map((entry) => entry.code);

  assert.deepEqual(await pooled(), [order.code]);
  assert.deepEqual(await pooled('廣州'), [order.code], 'found by the second leg\'s destination');
  const own = await ctx.orders.pool(dispatcher, {}, before);
  assert.deepEqual(own.map((entry) => [entry.code, entry.mine, entry.id]), [[order.code, true, order.id]], 'one entry, the dispatcher\'s own');
  await ctx.orders.claim(first.code, b);
  assert.deepEqual(await pooled(), [order.code], 'the second leg is still open');
  await ctx.orders.claim(second.code, c);
  assert.deepEqual(await pooled(), []);
  assert.equal((await ctx.orders.list(dispatcher, { role: 'dispatched' })).length, 1);
  assert.deepEqual((await ctx.orders.list(c, { role: 'claimed' })).map((leg) => leg.journey?.legIndex), [2]);
});

test('a driver sees the dispatcher\'s 名片頁 before claiming, and each side gets the other\'s WeChat and WhatsApp after', async () => {
  const dispatcher = await createDriver(ctx, '出單師傅');
  const driver = await createDriver(ctx, '接單師傅');
  const hidden = await createDriver(ctx, '未公開師傅');
  const page = (userId: string, code: string, published: boolean) =>
    ctx.prisma.profilePage.create({ data: { userId, code, published, wechatId: `wx-${code}`, whatsapp: '+852 6000 0000' } });
  await page(dispatcher, 'dispatcherpage', true);
  await page(driver, 'driverpage', true);
  await page(hidden, 'hiddenpage', false);
  const created = await ctx.orders.create(dispatcher, sampleOrder);

  const before = await ctx.orders.getByCode(created.code, driver);
  assert.equal(before.dispatcherPageCode, 'dispatcherpage');
  assert.equal('dispatcherContact' in before, false, 'no way to reach the dispatcher before claiming');
  assert.equal('dispatcherPhone' in before, false);

  const won = (await ctx.orders.claim(created.code, driver)).order;
  assert.equal(won.dispatcherContact?.wechatId, 'wx-dispatcherpage');
  assert.equal(won.dispatcherContact?.whatsapp, '+852 6000 0000');
  assert.deepEqual(won.dispatcherContact?.phones, [won.dispatcherPhone]);
  const mine = await ctx.orders.getForParticipant(dispatcher, created.id);
  assert.equal(mine.driver?.wechatId, 'wx-driverpage');
  assert.equal(mine.driver?.whatsapp, '+852 6000 0000');
  const passenger = await ctx.orders.getForPassenger(created.links.passengerConfirm.split('/c/')[1]);
  assert.equal('wechatId' in (passenger.driver ?? {}), false, 'of the driver, the passenger gets the phone only');
  // The passenger can reach whoever arranged the trip.
  assert.equal(passenger.dispatcher?.name, '出單師傅');
  assert.ok(passenger.dispatcher?.phone.startsWith('+852 '));
  assert.equal(passenger.dispatcher?.wechatId, 'wx-dispatcherpage');
  const selfDriven = await ctx.orders.create(dispatcher, { ...sampleOrder, selfDrive: true });
  assert.equal((await ctx.orders.getForPassenger(selfDriven.links.passengerConfirm.split('/c/')[1])).dispatcher, null);

  // A page that is not public is not linked, but the driver who took the order still gets the contacts on it.
  const quiet = await ctx.orders.create(hidden, sampleOrder);
  const open = await ctx.orders.getByCode(quiet.code, driver);
  assert.equal(open.dispatcherPageCode, null);
  assert.equal('dispatcherContact' in open, false);
  const taken = (await ctx.orders.claim(quiet.code, driver)).order;
  assert.equal(taken.dispatcherContact?.wechatId, 'wx-hiddenpage');
  assert.equal(taken.dispatcherPageCode, null);
});

test('客人通訊錄 lists the passengers of the orders someone put out, never those of orders they took', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const first = await ctx.orders.create(dispatcher, { ...transferOrder, passengerContact: sampleOrder.passengerContact, passengerName: '王小姐' });
  const cancelled = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.cancel(dispatcher, cancelled.id);
  await ctx.orders.create(dispatcher, { ...sampleOrder, passengerName: '陳先生', passengerContact: '+86 13800002222' });
  await ctx.orders.claim(first.code, driver);

  const book = await ctx.orders.passengers(dispatcher);
  assert.equal(book.length, 2);
  const regular = book.find((entry) => entry.contact === '+852 9876 5432');
  assert.equal(regular?.trips, 1, 'a 接駁 trip counts once and a cancelled order not at all');
  assert.ok(regular?.lastRoute.includes('→'));
  assert.equal(book.find((entry) => entry.contact === '+86 13800002222')?.name, '陳先生');
  assert.deepEqual(await ctx.orders.passengers(driver), [], 'the driver who took the order gets nothing');
});

test('both of a driver\'s numbers reach the dispatcher and the passenger; hidden plates stay from the passenger only', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const signIn = await ctx.prisma.user.findUniqueOrThrow({ where: { id: driver } });
  await ctx.prisma.driverProfile.update({
    where: { userId: driver },
    data: { hkMacauPhone: `+852 ${signIn.phone}`, mainlandPhone: '+86 13800001111', hidePlates: true },
  });
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(created.code, driver);

  const mine = await ctx.orders.getForParticipant(dispatcher, created.id);
  assert.deepEqual(mine.driver?.phones, [`+852 ${signIn.phone}`, '+86 13800001111'], 'the sign-in number is not listed twice');
  assert.ok(mine.driver?.hkPlate, 'the dispatcher still sees the plates');

  const passenger = await ctx.orders.getForPassenger(created.links.passengerConfirm.split('/c/')[1]);
  assert.deepEqual(passenger.driver?.phones, [`+852 ${signIn.phone}`, '+86 13800001111']);
  assert.equal(passenger.driver?.platesHidden, true);
  assert.equal(passenger.driver?.hkPlate, null);
});

test('once the trip is over the driver no longer gets the passenger phone; the dispatcher always does', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, { ...sampleOrder, contactRevealMinutes: null });
  const won = (await ctx.orders.claim(created.code, driver)).order;
  assert.equal(won.passengerContact, '+852 9876 5432');
  assert.equal(won.contactEnded, false);

  const done = await ctx.orders.complete(driver, created.id);
  assert.equal(done.passengerContact, null);
  assert.equal(done.contactEnded, true);
  assert.equal((await ctx.orders.getByCode(created.code, driver)).passengerContact, null, 'nor on the claim page');
  assert.equal((await ctx.orders.getForParticipant(dispatcher, created.id)).passengerContact, '+852 9876 5432');

  const second = await ctx.orders.create(dispatcher, { ...sampleOrder, contactRevealMinutes: null });
  await ctx.orders.claim(second.code, driver);
  await ctx.orders.cancel(dispatcher, second.id);
  assert.equal((await ctx.orders.getForParticipant(driver, second.id)).passengerContact, null, 'nor after a cancellation');
});

const PNG = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]).toString('base64')}`;

test('行程群: the dispatcher gives the trip a group; the passenger gets it, the driver when they may see the passenger', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, { ...sampleOrder, pickupAt: daysFromNow(3), contactRevealMinutes: 60 });
  const confirmCode = created.links.passengerConfirm.split('/c/')[1];
  await rejectsWith(ctx.orders.setTripGroup(driver, created.id, { platform: 'WHATSAPP', inviteUrl: 'https://chat.whatsapp.com/AbCdEf1234567890' }), 'ORDER_NOT_FOUND');

  const withLink = await ctx.orders.setTripGroup(dispatcher, created.id, { platform: 'WHATSAPP', inviteUrl: 'https://chat.whatsapp.com/AbCdEf1234567890' });
  assert.equal(withLink.tripGroup?.inviteUrl, 'https://chat.whatsapp.com/AbCdEf1234567890');
  assert.equal((await ctx.orders.getForPassenger(confirmCode)).tripGroup?.platform, 'WHATSAPP');
  assert.equal('tripGroup' in (await ctx.orders.getByCode(created.code)), false, 'nobody else');

  // The pickup is days away: the driver does not get the passenger, so not the group either.
  await ctx.orders.claim(created.code, driver);
  assert.equal((await ctx.orders.getForParticipant(driver, created.id)).tripGroup, null);
  await ctx.orders.setContactReveal(dispatcher, created.id, { contactRevealMinutes: null });
  assert.equal((await ctx.orders.getForParticipant(driver, created.id)).tripGroup?.platform, 'WHATSAPP');

  // A WeChat group QR replaces the link and stops after seven days.
  await rejectsWith(ctx.orders.setTripGroup(dispatcher, created.id, { platform: 'WECHAT', qrImage: 'data:image/png;base64,AAAA' }), 'QR_IMAGE_INVALID');
  const now = new Date();
  const withQr = await ctx.orders.setTripGroup(dispatcher, created.id, { platform: 'WECHAT', qrImage: PNG }, now);
  assert.equal(withQr.tripGroup?.inviteUrl, null);
  assert.ok(withQr.tripGroup?.qrUrl?.startsWith(`/api/orders/${created.id}/trip-group/qr`));
  assert.ok(await ctx.orders.tripGroupQr({ confirmCode }));
  assert.ok(await ctx.orders.tripGroupQr({ userId: driver, id: created.id }));
  assert.equal(await ctx.orders.tripGroupQr({ userId: await createDriver(ctx), id: created.id }), null);
  const later = new Date(now.getTime() + 8 * 24 * 60 * 60 * 1000);
  assert.equal(await ctx.orders.tripGroupQr({ confirmCode }, later), null);

  await ctx.orders.complete(driver, created.id);
  assert.equal((await ctx.orders.getForParticipant(driver, created.id)).tripGroup, null, 'gone for the driver once the trip is over');
  assert.equal(await ctx.orders.tripGroupQr({ userId: driver, id: created.id }), null);
  assert.equal((await ctx.orders.setTripGroup(dispatcher, created.id, { platform: null })).tripGroup, null);
  assert.equal((await ctx.orders.getForPassenger(confirmCode)).tripGroup, null);
});

test('已結清 is the dispatcher\'s mark on a finished order; the driver sees it and cannot set it', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(created.code, driver);
  await rejectsWith(ctx.orders.setSettlement(dispatcher, created.id, { settled: true }), 'INVALID_ORDER_STATUS');
  await ctx.orders.complete(driver, created.id);

  await rejectsWith(ctx.orders.setSettlement(driver, created.id, { settled: true }), 'ORDER_NOT_FOUND');
  const marked = await ctx.orders.setSettlement(dispatcher, created.id, { settled: true });
  assert.ok(marked.settledAt);
  assert.ok((await ctx.orders.getForParticipant(driver, created.id)).settledAt, 'the driver sees the mark');
  assert.equal('settledAt' in (await ctx.orders.getByCode(created.code)), false, 'nobody else does');
  assert.equal((await ctx.orders.setSettlement(dispatcher, created.id, { settled: false })).settledAt, null);

  // 這單我自己做: there is nobody to settle with.
  const own = await ctx.orders.create(dispatcher, { ...sampleOrder, selfDrive: true });
  await ctx.orders.complete(dispatcher, own.id);
  await rejectsWith(ctx.orders.setSettlement(dispatcher, own.id, { settled: true }), 'INVALID_ORDER_STATUS');
});

test('這單我自己做: the dispatcher drives the leg, nobody can claim it, and 改派 offers it to the group', async () => {
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

  assert.equal(pool[0].mine, false);
  // Their own order is listed for them too, as others see it, marked theirs and opening their own page.
  const own = await ctx.orders.pool(dispatcher, {}, BEFORE_PICKUP);
  assert.deepEqual(own.map((order) => [order.code, order.mine, order.id]), [[listed.code, true, listed.id]]);
  for (const hidden of ['passengerName', 'passengerContact', 'passengerPrice', 'links']) {
    assert.equal(hidden in own[0], false, hidden);
  }

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

test('the 接單池 default comes from the dispatcher, and 這單我自己做 never enters it', async () => {
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

test('the passenger sees the dispatcher’s 名片頁 to book them next time, only while it is public', async () => {
  const dispatcher = await createDriver(ctx, '李師傅');
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  const confirmCode = order.links.passengerConfirm.split('/c/')[1];
  assert.equal((await ctx.orders.getForPassenger(confirmCode)).dispatcher?.pageCode, null);

  const page = await ctx.profilePages.update(dispatcher, { published: true });
  assert.equal((await ctx.orders.getForPassenger(confirmCode)).dispatcher?.pageCode, page.code);

  await ctx.profilePages.staffBlock(dispatcher, '照片含廣告');
  assert.equal((await ctx.orders.getForPassenger(confirmCode)).dispatcher?.pageCode, null, 'taken down: unpublished');
});

// 往返: one order in two legs, there and back; one driver for both (同一位司機來回) or leg by leg (可分開接).

const roundTripOrder = {
  ...sampleOrder,
  origin: '香港',
  destination: '深圳',
  vehicleType: '7座',
  driverPrice: { amount: 400, currency: 'HKD' as const },
  passengerPrice: { amount: 1200, currency: 'HKD' as const },
  showPassengerPrice: true,
  roundTrip: { pickupAt: '2026-10-15T20:00:00+08:00', driverPrice: { amount: 500, currency: 'HKD' as const }, sameDriver: true, selfDriveLeg: null },
};
const apart = { ...roundTripOrder, roundTrip: { ...roundTripOrder.roundTrip, sameDriver: false } };

test('a 往返 is one order in two legs, there and back: quota and fee once, one text, one link', async () => {
  await ctx.commission.update({ enabled: true, fee: 5 }, 'test');
  const dispatcher = await createDriver(ctx);
  await ctx.credits.credit(dispatcher, 2000, { type: 'TOPUP', source: 'MANUAL', createdBy: 'test' });

  const order = await ctx.orders.create(dispatcher, roundTripOrder);

  assert.equal(await balanceOf(dispatcher), 1500, 'charged once');
  const usage = await ctx.prisma.usage.findMany({ where: { userId: dispatcher } });
  assert.equal(usage.reduce((sum, row) => sum + row.used, 0), 1, 'one order of quota');
  assert.equal(order.journey?.kind, 'ROUND_TRIP');
  assert.equal(order.journey?.sameDriver, true);
  assert.equal(order.journey?.destination, '深圳');
  assert.deepEqual(order.journey?.legs.map((leg) => `${leg.origin}→${leg.destination}`), ['香港→深圳', '深圳→香港']);
  const stored = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(stored.map((leg) => [leg.journeyKind, leg.sameDriver]), [['ROUND_TRIP', true], ['ROUND_TRIP', true]]);
  assert.deepEqual(stored.map((leg) => leg.passengerPriceMinor), [120000, null], 'one passenger price, on the way there');
  assert.deepEqual(stored.map((leg) => leg.driverPriceMinor), [40000, 50000]);
  assert.deepEqual(order.margin, { amount: 300, currency: 'HKD' }, 'the one passenger price against both legs');

  const text = order.share.dispatch.wechat;
  assert.ok(text.startsWith('【有單・往返】10/15（四）14:30'));
  assert.ok(text.includes('香港 ⇄ 深圳'));
  assert.ok(text.includes('回程：10/15（四）20:00 深圳 → 香港｜HK$500'));
  assert.ok(text.includes('同一位司機來回，來回共 HK$900'), 'what both legs pay together');
  assert.ok(text.endsWith(`搶單（來回）：${order.links.dispatch}`));
  assert.ok(!text.includes('接駁'));
  assert.ok(order.share.passenger.includes('往返行程'));

  await rejectsWith(
    ctx.orders.create(dispatcher, { ...roundTripOrder, roundTrip: { ...roundTripOrder.roundTrip, pickupAt: '2026-10-15T13:00:00+08:00' } }),
    'LEG_BEFORE_PREVIOUS',
  );
});

test('同一位司機來回: one claim takes both legs, from either link; of two drivers at once only one gets them', async () => {
  const dispatcher = await createDriver(ctx);
  const [b, c] = await Promise.all(['B', 'C'].map((name) => createDriver(ctx, name)));
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, roundTripOrder);
  const [, back] = order.journey!.legs;

  assert.equal((await ctx.orders.claim(back.code, b)).result, 'WON', 'the way back\'s link takes the trip too');
  const legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(legs.map((leg) => [leg.status, leg.claimedById]), [['ASSIGNED', b], ['ASSIGNED', b]]);
  assert.equal(await ctx.prisma.orderClaim.count({ where: { driverId: b, result: 'WON' } }), 2, 'kept on each leg');
  assert.equal((await ctx.orders.claim(order.code, c)).result, 'LOST');
  assert.equal(await ctx.prisma.notification.count({ where: { userId: dispatcher, kind: 'ORDER_CLAIMED' } }), 1, 'told once');
  const mine = await ctx.orders.drivers(dispatcher);
  assert.equal(mine.find((driver) => driver.id === b)?.taken, 1, '我的司機 counts the trip once');

  const again = await ctx.orders.create(dispatcher, roundTripOrder);
  const codes = again.journey!.legs.map((leg) => leg.code);
  const taps = await Promise.all([ctx.orders.claim(codes[0], b), ctx.orders.claim(codes[1], c)]);
  assert.deepEqual(taps.map((tap) => tap.result).sort(), ['LOST', 'WON']);
  const winner = taps[0].result === 'WON' ? b : c;
  assert.equal(await ctx.prisma.order.count({ where: { journeyId: again.id, claimedById: winner, status: 'ASSIGNED' } }), 2);
});

test('同一位司機來回: 取消接單 and 改派 move both legs; cancelling cancels both', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, roundTripOrder);
  await ctx.orders.claim(order.code, driver);
  const legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });

  await ctx.orders.release(driver, legs[1].id);
  let after = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(after.map((leg) => [leg.status, leg.claimedById]), [['OPEN', null], ['OPEN', null]]);
  assert.equal(await ctx.prisma.orderClaim.count({ where: { driverId: driver, releasedAt: { not: null } } }), 2);

  await ctx.orders.claim(order.code, driver);
  await ctx.orders.reopen(dispatcher, legs[0].id);
  after = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(after.map((leg) => leg.status), ['OPEN', 'OPEN']);
  assert.equal(await ctx.prisma.notification.count({ where: { userId: driver, kind: 'ORDER_REOPENED' } }), 1, 'told once for the trip');

  await ctx.orders.cancel(dispatcher, legs[1].id);
  after = await ctx.prisma.order.findMany({ where: { journeyId: order.id } });
  assert.ok(after.every((leg) => leg.status === 'CANCELLED'));
});

test('可分開接: each leg is claimed on its own, and one driver may take both', async () => {
  const dispatcher = await createDriver(ctx);
  const [b, c] = await Promise.all(['B', 'C'].map((name) => createDriver(ctx, name)));
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, apart);
  const [there, back] = order.journey!.legs;
  assert.ok(order.share.dispatch.wechat.includes('可分開接，選一程搶'));

  assert.equal((await ctx.orders.claim(there.code, b)).result, 'WON');
  let legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(legs.map((leg) => leg.status), ['ASSIGNED', 'OPEN'], 'only the leg claimed');
  assert.equal((await ctx.orders.claim(back.code, b)).result, 'WON', 'the same driver takes the way back too');

  await ctx.orders.release(b, legs[1].id);
  legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(legs.map((leg) => [leg.status, leg.claimedById]), [['ASSIGNED', b], ['OPEN', null]], '取消接單 gives back that leg only');
  assert.equal((await ctx.orders.claim(back.code, c)).result, 'WON');

  // 自己做其中一程: that leg is the dispatcher's, the other goes to the group.
  const own = await ctx.orders.create(dispatcher, { ...apart, roundTrip: { ...apart.roundTrip, selfDriveLeg: 2 } });
  assert.deepEqual(own.journey?.legs.map((leg) => [leg.status, leg.selfDrive]), [['OPEN', false], ['ASSIGNED', true]]);
  assert.ok(own.share.dispatch.wechat.includes('回程：10/15（四）20:00 深圳 → 香港｜出單者自己開'));
});

test('來回我自己做: both legs are the dispatcher\'s; nothing to claim', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, { ...roundTripOrder, selfDrive: true });
  assert.deepEqual(order.journey?.legs.map((leg) => [leg.status, leg.selfDrive]), [['ASSIGNED', true], ['ASSIGNED', true]]);
  assert.equal((await ctx.orders.claim(order.code, driver)).result, 'LOST');
});

test('the passenger sees both legs with their times and one price; 修改行程 changes the places of that leg only', async () => {
  const dispatcher = await createDriver(ctx, '派單師傅');
  const driver = await createDriver(ctx, '來回師傅');
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, roundTripOrder);
  const confirmCode = order.links.passengerConfirm.split('/c/')[1];
  await ctx.orders.claim(order.code, driver);

  const trip = await ctx.orders.getForPassenger(confirmCode);
  assert.equal(trip.roundTrip, true);
  assert.equal(trip.sameDriver, true);
  assert.equal(trip.transfer, false);
  assert.deepEqual(trip.price, { amount: 1200, currency: 'HKD' });
  assert.deepEqual(
    trip.legs?.map((leg) => ['pickupAt' in leg ? leg.pickupAt : null, leg.driver?.name ?? null]),
    [
      ['2026-10-15T06:30:00.000Z', '來回師傅'],
      ['2026-10-15T12:00:00.000Z', '來回師傅'],
    ],
  );

  const legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  // Each leg's places are its own: the way back may leave from or go to somewhere else.
  await ctx.orders.updateTrip(dispatcher, legs[0].id, { origin: '香港機場', destination: '深圳灣' });
  let after = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(after.map((leg) => `${leg.origin}→${leg.destination}`), ['香港機場→深圳灣', '深圳→香港']);
  await ctx.orders.updateTrip(dispatcher, legs[1].id, { origin: '福田口岸' });
  after = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(after.map((leg) => `${leg.origin}→${leg.destination}`), ['香港機場→深圳灣', '福田口岸→香港']);
  assert.deepEqual(after.map((leg) => leg.changePendingAt !== null), [true, true], 'the driver of each changed leg is told');
  await rejectsWith(ctx.orders.updateTrip(dispatcher, legs[0].id, { transferPlace: '皇崗' }), 'NOT_A_TRANSFER');
});

test('each leg of a 往返 has its own flight; 修改行程 changes the flight on that leg only', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx, '來回師傅');
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, {
    ...roundTripOrder,
    destination: '香港國際機場',
    flightNo: 'CX101',
    roundTrip: { ...roundTripOrder.roundTrip, flightNo: 'CX102' },
  });
  const legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(legs.map((leg) => leg.flightNo), ['CX101', 'CX102']);
  assert.ok(order.share.dispatch.wechat.includes('去程：10/15（四）14:30 香港 → 香港國際機場｜航班 CX101｜HK$400'));
  assert.ok(order.share.dispatch.wechat.includes('回程：10/15（四）20:00 香港國際機場 → 香港｜航班 CX102｜HK$500'));
  assert.deepEqual(order.journey?.legs.map((leg) => leg.flightNo), ['CX101', 'CX102']);
  const confirmCode = order.links.passengerConfirm.split('/c/')[1];
  assert.deepEqual(
    (await ctx.orders.getForPassenger(confirmCode)).legs?.map((leg) => ('flightNo' in leg ? leg.flightNo : null)),
    ['CX101', 'CX102'],
  );

  await ctx.orders.updateTrip(dispatcher, legs[1].id, { flightNo: 'CX202' });
  const after = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(after.map((leg) => leg.flightNo), ['CX101', 'CX202']);

  // 同一位司機來回 claimed: the 已派出 text says when the way back leaves.
  await ctx.orders.claim(order.code, driver);
  const seen = await ctx.orders.getForParticipant(dispatcher, legs[1].id);
  assert.ok('share' in seen && seen.share.claimed?.startsWith('【已派出】10/15（四）14:30 香港 → 香港國際機場（來回，回程 10/15（四）20:00）'));
});

test('the way back may leave from and go to other places than the way there reversed', async () => {
  const dispatcher = await createDriver(ctx);
  await freeForAll();
  const order = await ctx.orders.create(dispatcher, {
    ...roundTripOrder,
    roundTrip: { ...roundTripOrder.roundTrip, origin: '福田口岸', destination: '九龍塘' },
  });
  assert.deepEqual(order.journey?.legs.map((leg) => `${leg.origin}→${leg.destination}`), ['香港→深圳', '福田口岸→九龍塘']);
  const text = order.share.dispatch.wechat;
  assert.ok(!text.includes('⇄'), 'A ⇄ B only when the way back is the way there reversed');
  assert.ok(text.includes('回程：10/15（四）20:00 福田口岸 → 九龍塘｜HK$500'));
  // Without places, the way back is the way there reversed.
  const reversed = await ctx.orders.create(dispatcher, roundTripOrder);
  assert.deepEqual(reversed.journey?.legs.map((leg) => `${leg.origin}→${leg.destination}`), ['香港→深圳', '深圳→香港']);
  assert.ok(reversed.share.dispatch.wechat.includes('香港 ⇄ 深圳'));
});

// 出單者代確認: the dispatcher confirms for a passenger who said yes but never pressed the link.
test('出單者代確認: only the dispatcher may confirm for the passenger, everyone can tell, and it can be taken back', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx, '李師傅');
  const other = await createDriver(ctx);
  const created = await ctx.orders.create(dispatcher, sampleOrder);
  const confirmCode = created.links.passengerConfirm.split('/c/')[1];
  await ctx.orders.claim(created.code, driver);

  await rejectsWith(ctx.orders.confirmForPassenger(driver, created.id, { confirmed: true }), 'ORDER_NOT_FOUND');
  await rejectsWith(ctx.orders.confirmForPassenger(other, created.id, { confirmed: true }), 'ORDER_NOT_FOUND');
  const mine = await ctx.orders.confirmForPassenger(dispatcher, created.id, { confirmed: true });
  assert.ok(mine.passengerConfirmedAt);
  assert.equal(mine.passengerConfirmedByDispatcher, true);
  assert.equal((await ctx.orders.getForParticipant(driver, created.id)).passengerConfirmedByDispatcher, true, 'the driver can tell');
  const passenger = await ctx.orders.getForPassenger(confirmCode);
  assert.ok(passenger.passengerConfirmedAt);
  assert.equal(passenger.confirmedByDispatcher, true, 'the passenger is told who confirmed');
  assert.equal(await ctx.prisma.notification.count({ where: { userId: dispatcher, kind: 'ORDER_CONFIRMED' } }), 0, 'nobody is told what they did themselves');

  const undone = await ctx.orders.confirmForPassenger(dispatcher, created.id, { confirmed: false });
  assert.equal(undone.passengerConfirmedAt, null);
  assert.equal(undone.passengerConfirmedByDispatcher, false);

  // The passenger's own confirmation is theirs: taking back changes nothing, and it reads as theirs.
  await ctx.orders.confirmByPassenger(confirmCode);
  const own = await ctx.orders.confirmForPassenger(dispatcher, created.id, { confirmed: false });
  assert.ok(own.passengerConfirmedAt);
  assert.equal(own.passengerConfirmedByDispatcher, false);
  assert.equal((await ctx.orders.getForPassenger(confirmCode)).confirmedByDispatcher, false);

  // 改派 starts over with the next driver, as the passenger's own confirmation does.
  await ctx.orders.reopen(dispatcher, created.id);
  await ctx.orders.confirmForPassenger(dispatcher, created.id, { confirmed: true });
  await ctx.orders.claim(created.code, other);
  await ctx.orders.reopen(dispatcher, created.id);
  const reopened = await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.id } });
  assert.deepEqual([reopened.passengerConfirmedAt, reopened.passengerConfirmedByDispatcher], [null, false]);

  await ctx.orders.cancel(dispatcher, created.id);
  await rejectsWith(ctx.orders.confirmForPassenger(dispatcher, created.id, { confirmed: true }), 'INVALID_ORDER_STATUS');
});

test('出單者代確認 on 往返 and 接駁 covers the whole order from either leg, and so does taking it back', async () => {
  const dispatcher = await createDriver(ctx);
  await freeForAll();
  for (const input of [roundTripOrder, transferOrder]) {
    const order = await ctx.orders.create(dispatcher, input);
    const second = await ctx.prisma.order.findFirstOrThrow({ where: { journeyId: order.id, legIndex: 2 } });
    await ctx.orders.confirmForPassenger(dispatcher, second.id, { confirmed: true });
    const legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id } });
    assert.ok(legs.every((leg) => leg.passengerConfirmedAt && leg.passengerConfirmedByDispatcher), 'every leg');
    const passenger = await ctx.orders.getForPassenger(order.links.passengerConfirm.split('/c/')[1]);
    assert.equal(passenger.confirmedByDispatcher, true);

    await ctx.orders.confirmForPassenger(dispatcher, order.id, { confirmed: false });
    assert.equal(await ctx.prisma.order.count({ where: { journeyId: order.id, passengerConfirmedAt: { not: null } } }), 0);
  }
});

test('包鐘: the prices an hour make the totals; hours and prices change by the hour, and the driver confirms new hours', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx, '李師傅');
  const created = await ctx.orders.create(dispatcher, {
    ...sampleOrder,
    pickupAt: daysFromNow(2),
    destination: sampleOrder.origin,
    waypoints: ['羅湖', '東門'],
    charter: {
      minutes: 480,
      driverHourly: { amount: 250, currency: 'HKD' as const },
      passengerHourly: { amount: 300, currency: 'HKD' as const },
      overtimeUnitMinutes: 30 as const,
      overtimeGraceMinutes: 15,
      extras: ['TOLLS' as const],
    },
  });
  // Quota and fee as any order: one.
  assert.equal(await ctx.prisma.order.count({ where: { dispatcherId: dispatcher } }), 1);
  assert.deepEqual(created.driverPrice, { amount: 2000, currency: 'HKD' });
  assert.deepEqual(created.passengerPrice, { amount: 2400, currency: 'HKD' });
  assert.deepEqual(created.margin, { amount: 400, currency: 'HKD' });
  assert.equal(created.charter?.minutes, 480);
  assert.match(created.share.dispatch.wechat, /^【有單・包鐘】.+ 起 8 小時\n/);
  assert.match(created.share.dispatch.wechat, /\n每小時 HK\$250，8 小時共 HK\$2,000\n/);
  assert.doesNotMatch(created.share.dispatch.wechat, /2,400|HK\$300/, 'never the passenger price');

  // A total of its own is refused; its prices change by the hour.
  await rejectsWith(ctx.orders.updatePrices(dispatcher, created.id, { driverPrice: { amount: 1800, currency: 'HKD' } }), 'CHARTER_PRICE_HOURLY');
  const raised = (await ctx.orders.updatePrices(dispatcher, created.id, { driverHourly: { amount: 260, currency: 'HKD' } })) as typeof created;
  assert.deepEqual(raised.driverPrice, { amount: 2080, currency: 'HKD' });

  // A driver sees what an hour pays, never the passenger's.
  const claimed = await ctx.orders.claim(created.code, driver);
  assert.deepEqual(claimed.order.charter?.driverHourly, { amount: 260, currency: 'HKD' });
  assert.equal('passengerHourly' in (claimed.order.charter ?? {}), false);

  // Two more hours: the totals follow, and the driver is asked to confirm.
  const longer = (await ctx.orders.updateTrip(dispatcher, created.id, { charterMinutes: 600 })) as typeof created;
  assert.deepEqual(longer.driverPrice, { amount: 2600, currency: 'HKD' });
  assert.deepEqual(longer.passengerPrice, { amount: 3000, currency: 'HKD' });
  const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: created.id } });
  assert.equal(stored.changeSummary, '時數');

  // Hours only on a 包鐘; prices by the hour only on a 包鐘.
  const plain = await ctx.orders.create(dispatcher, sampleOrder);
  await rejectsWith(ctx.orders.updateTrip(dispatcher, plain.id, { charterMinutes: 480 }), 'NOT_A_CHARTER');
  await rejectsWith(ctx.orders.updatePrices(dispatcher, plain.id, { driverHourly: { amount: 250, currency: 'HKD' } }), 'NOT_A_CHARTER');
});
