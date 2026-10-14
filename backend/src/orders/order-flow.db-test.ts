import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, rejectsWith, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';

let ctx: TestContext;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 50);
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

const transferOrder = {
  ...sampleOrder,
  origin: '香港',
  destination: '廣州',
  vehicleType: '7座',
  driverPrice: { amount: 400, currency: 'HKD' as const },
  transfer: {
    place: '深圳灣口岸',
    pickupAt: '2026-10-15T16:00:00+08:00',
    driverPrice: { amount: 600, currency: 'CNY' as const },
    requiredPlates: [],
    selfDriveLeg: null,
  },
};
const BEFORE_PICKUP = new Date('2026-10-14T09:00:00+08:00');

test('航班號 goes into the group text and is shown to drivers and the passenger', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, { ...sampleOrder, vehicleType: '7座', flightNo: 'CX123' });
  assert.ok(order.share.dispatch.wechat.includes('航班：CX123'));
  assert.equal((await ctx.orders.getByCode(order.code, driver)).flightNo, 'CX123');
  const trip = await ctx.orders.create(dispatcher, { ...transferOrder, flightNo: 'MU501' });
  assert.ok(trip.share.dispatch.wechat.includes('航班：MU501'));
  assert.equal((await ctx.orders.getForPassenger(trip.links.passengerConfirm.split('/c/')[1])).flightNo, 'MU501');
});

test('先給常用司機: only the dispatcher\'s regular drivers claim or see it in the pool for 30 minutes', async () => {
  const dispatcher = await createDriver(ctx, '出單師傅');
  const regular = await createDriver(ctx, '熟手');
  const other = await createDriver(ctx, '路人');
  const now = new Date('2026-10-14T08:00:00+08:00');

  // Without 常用司機 the choice changes nothing.
  const plain = await ctx.orders.create(dispatcher, { ...sampleOrder, favoritesFirst: true, inPool: true }, now);
  const until = async (id: string) => (await ctx.prisma.order.findUniqueOrThrow({ where: { id } })).favoritesUntil?.toISOString() ?? null;
  assert.equal(await until(plain.id), null);

  // A driver becomes one only after taking the dispatcher's order.
  await rejectsWith(ctx.orders.updateDriverNote(dispatcher, regular, { favorite: true }), 'DRIVER_NOT_FOUND');
  await ctx.orders.claim(plain.code, regular, now);
  const marked = await ctx.orders.updateDriverNote(dispatcher, regular, { favorite: true, note: '準時' });
  assert.deepEqual([marked?.favorite, marked?.note], [true, '準時']);

  const first = await ctx.orders.create(dispatcher, { ...sampleOrder, favoritesFirst: true, inPool: true }, now);
  assert.equal(await until(first.id), new Date(now.getTime() + 30 * 60_000).toISOString());
  const inPool = async (userId: string) => (await ctx.orders.pool(userId, {}, now)).map((order) => order.code);
  assert.deepEqual(await inPool(other), []);
  assert.deepEqual(await inPool(regular), [first.code]);
  await rejectsWith(ctx.orders.claim(first.code, other, now), 'FAVORITES_FIRST');
  assert.equal((await ctx.orders.claim(first.code, other, new Date(now.getTime() + 31 * 60_000))).result, 'WON', 'everyone after 30 minutes');

  const second = await ctx.orders.create(dispatcher, { ...sampleOrder, favoritesFirst: true }, now);
  assert.equal((await ctx.orders.claim(second.code, regular, now)).result, 'WON');
});

test('行程進度: the driver reports each step once; 改派 and 取消接單 clear it', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const other = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  await rejectsWith(ctx.orders.progress(driver, order.id, { step: 'DEPARTED' }), 'ORDER_NOT_FOUND');
  await ctx.orders.claim(order.code, driver);
  await rejectsWith(ctx.orders.progress(other, order.id, { step: 'DEPARTED' }), 'ORDER_NOT_FOUND');

  const at = new Date('2026-10-15T13:50:00+08:00');
  const departed = await ctx.orders.progress(driver, order.id, { step: 'DEPARTED' }, at);
  assert.equal(departed.progress?.departedAt, at.toISOString());
  const again = await ctx.orders.progress(driver, order.id, { step: 'DEPARTED' }, new Date(at.getTime() + 60_000));
  assert.equal(again.progress?.departedAt, at.toISOString(), 'the first time stands');
  await ctx.orders.progress(driver, order.id, { step: 'PICKED_UP' }, at);
  const passenger = await ctx.orders.getForPassenger(order.links.passengerConfirm.split('/c/')[1]);
  assert.equal(passenger.progress.pickedUpAt, at.toISOString());
  assert.equal((await ctx.orders.getForParticipant(dispatcher, order.id)).progress?.departedAt, at.toISOString());

  await ctx.orders.reopen(dispatcher, order.id);
  const stored = await ctx.prisma.order.findUniqueOrThrow({ where: { id: order.id } });
  assert.deepEqual([stored.departedAt, stored.pickedUpAt], [null, null]);
  await ctx.orders.claim(order.code, other);
  await ctx.orders.complete(other, order.id);
  await rejectsWith(ctx.orders.progress(other, order.id, { step: 'ARRIVED' }), 'INVALID_ORDER_STATUS');
});

test('修改行程: the driver who took it is told what changed and confirms with 知道了', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, { ...sampleOrder, vehicleType: '7座' });

  // Nobody has it yet: changed without anyone to tell.
  const open = await ctx.orders.updateTrip(dispatcher, order.id, { passengers: 3 });
  assert.equal(open.passengers, 3);
  assert.equal(open.change, null);
  await rejectsWith(ctx.orders.updateTrip(dispatcher, order.id, { passengers: 3 }), 'NOTHING_CHANGED');
  await rejectsWith(ctx.orders.updateTrip(driver, order.id, { passengers: 2 }), 'ORDER_NOT_FOUND');
  await rejectsWith(ctx.orders.updateTrip(dispatcher, order.id, { transferPlace: '皇崗' }), 'NOT_A_TRANSFER');

  await ctx.orders.claim(order.code, driver);
  await ctx.orders.updateTrip(dispatcher, order.id, { pickupAt: '2026-10-15T15:00:00+08:00' });
  const changed = await ctx.orders.updateTrip(dispatcher, order.id, { origin: '皇崗口岸', flightNo: 'CX8' });
  assert.equal(changed.change?.summary, '時間、上車地點、航班', 'changes add up until confirmed');
  const seen = await ctx.orders.getForParticipant(driver, order.id);
  assert.deepEqual([seen.origin, seen.pickupAt, seen.change?.summary], ['皇崗口岸', '2026-10-15T07:00:00.000Z', '時間、上車地點、航班']);
  assert.equal(await ctx.prisma.notification.count({ where: { userId: driver, kind: 'ORDER_CHANGED' } }), 2);

  await rejectsWith(ctx.orders.ackChange(dispatcher, order.id), 'ORDER_NOT_FOUND');
  const acked = await ctx.orders.ackChange(driver, order.id);
  assert.equal(acked.change, null);
  assert.equal(await ctx.prisma.notification.count({ where: { userId: dispatcher, kind: 'ORDER_CHANGE_ACKED' } }), 1);
  await rejectsWith(ctx.orders.ackChange(driver, order.id), 'INVALID_ORDER_STATUS');
});

test('修改行程 on a 接駁 order: the trip\'s ends, its 接駁位置 and each leg\'s own time', async () => {
  const dispatcher = await createDriver(ctx);
  const first = await createDriver(ctx);
  const second = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, transferOrder);
  const [legOne, legTwo] = order.journey!.legs;
  await ctx.orders.claim(legTwo.code, second);

  await ctx.orders.updateTrip(dispatcher, order.id, { transferPlace: '皇崗口岸', luggage: 1 });
  const legs = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(legs.map((leg) => `${leg.origin}→${leg.destination}`), ['香港→皇崗口岸', '皇崗口岸→廣州']);
  assert.deepEqual(legs.map((leg) => leg.luggage), [1, 1]);
  assert.deepEqual(legs.map((leg) => leg.changeSummary), [null, '接駁位置、行李'], 'only the leg someone took waits for a 知道了');
  await rejectsWith(ctx.orders.updateTrip(dispatcher, legOne.id!, { pickupAt: '2026-10-15T17:00:00+08:00' }), 'LEG_BEFORE_PREVIOUS');
  await ctx.orders.claim(legOne.code, first);
  await ctx.orders.updateTrip(dispatcher, legOne.id!, { pickupAt: '2026-10-15T14:00:00+08:00' });
  const after = await ctx.prisma.order.findMany({ where: { journeyId: order.id }, orderBy: { legIndex: 'asc' } });
  assert.deepEqual(after.map((leg) => leg.changeSummary), ['時間', '接駁位置、行李']);
});

test('我的司機: who took the dispatcher\'s orders, how often, and the dispatcher\'s own marks', async () => {
  const dispatcher = await createDriver(ctx, '出單師傅');
  const steady = await createDriver(ctx, '穩陣');
  const flaky = await createDriver(ctx, '甩單');
  const stranger = await createDriver(ctx, '陌生');
  const one = await ctx.orders.create(dispatcher, sampleOrder);
  const two = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(one.code, flaky);
  await ctx.orders.release(flaky, one.id);
  await ctx.orders.claim(one.code, steady);
  await ctx.orders.complete(steady, one.id);
  await ctx.orders.claim(two.code, steady);
  await ctx.orders.updateDriverNote(dispatcher, flaky, { note: '試過甩單' });

  const drivers = await ctx.orders.drivers(dispatcher);
  const row = (name: string) => drivers.find((driver) => driver.name === name)!;
  assert.deepEqual([row('穩陣').taken, row('穩陣').completed, row('穩陣').released], [2, 1, 0]);
  assert.deepEqual([row('甩單').taken, row('甩單').released, row('甩單').note], [0, 1, '試過甩單']);
  assert.equal(drivers.some((driver) => driver.name === '陌生'), false);
  await rejectsWith(ctx.orders.updateDriverNote(dispatcher, stranger, { favorite: true }), 'DRIVER_NOT_FOUND');
  assert.deepEqual(await ctx.orders.drivers(steady), [], 'only the dispatcher sees their own list');
});

test('還沒人接: the dispatcher is told 3 hours and 1 hour before an open order, once each', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const created = new Date('2026-10-15T08:00:00+08:00');
  const open = await ctx.orders.create(dispatcher, sampleOrder, created);
  const taken = await ctx.orders.create(dispatcher, sampleOrder, created);
  await ctx.orders.claim(taken.code, driver);
  const unclaimed = () => ctx.prisma.notification.findMany({ where: { userId: dispatcher, kind: 'ORDER_UNCLAIMED' }, orderBy: { createdAt: 'asc' } });

  await ctx.notifications.list(dispatcher, new Date('2026-10-15T11:00:00+08:00'));
  assert.equal((await unclaimed()).length, 0, 'not yet 3 hours before 14:30');
  await ctx.notifications.list(dispatcher, new Date('2026-10-15T11:40:00+08:00'));
  await ctx.notifications.list(dispatcher, new Date('2026-10-15T11:50:00+08:00'));
  let lines = await unclaimed();
  assert.equal(lines.length, 1);
  assert.equal(lines[0].orderId, open.id);
  assert.equal(lines[0].createdAt.toISOString(), new Date('2026-10-15T11:30:00+08:00').toISOString());
  await ctx.notifications.list(dispatcher, new Date('2026-10-15T13:45:00+08:00'));
  lines = await unclaimed();
  assert.equal(lines.length, 2, 'again an hour before');

  // An order put out inside the window is not reminded of a time before it existed.
  const late = await ctx.orders.create(dispatcher, { ...sampleOrder, pickupAt: '2026-10-15T15:30:00+08:00' });
  await ctx.prisma.order.update({ where: { id: late.id }, data: { createdAt: new Date('2026-10-15T13:00:00+08:00') } });
  await ctx.notifications.list(dispatcher, new Date('2026-10-15T14:00:00+08:00'));
  assert.equal((await unclaimed()).filter((line) => line.orderId === late.id).length, 0);
  await ctx.notifications.list(dispatcher, new Date('2026-10-15T14:40:00+08:00'));
  assert.equal((await unclaimed()).filter((line) => line.orderId === late.id).length, 1);
});

test('即時單: leaves when it is put out, stays in the 接單池 while open, and is reminded once after 10 minutes', async () => {
  const dispatcher = await createDriver(ctx, '出單師傅');
  const regular = await createDriver(ctx, '熟手');
  const other = await createDriver(ctx, '路人');
  const posted = new Date('2026-10-15T08:00:00+08:00');
  const after = (minutes: number) => new Date(posted.getTime() + minutes * 60_000);
  const earlier = await ctx.orders.create(dispatcher, sampleOrder, new Date('2026-10-14T08:00:00+08:00'));
  await ctx.orders.claim(earlier.code, regular, new Date('2026-10-14T08:00:00+08:00'));
  await ctx.orders.updateDriverNote(dispatcher, regular, { favorite: true });

  const order = await ctx.orders.create(dispatcher, { ...sampleOrder, immediate: true, favoritesFirst: true, inPool: true }, posted);
  assert.equal(order.immediate, true);
  assert.equal(order.pickupAt, posted.toISOString(), 'the time it was put out, not the one sent');
  assert.equal(order.favoritesOnlyUntil, null, '先給常用司機 never holds a 即時單 back');
  assert.equal(order.share.dispatch.wechat.split('\n')[0], '【即時】現在出發');

  // In the 接單池 by default; the dispatcher can still keep it to the link.
  const listed = await ctx.orders.create(dispatcher, { ...sampleOrder, immediate: true }, posted);
  assert.equal((await ctx.prisma.order.findUniqueOrThrow({ where: { id: listed.id } })).inPool, true);
  const linkOnly = await ctx.orders.create(dispatcher, { ...sampleOrder, immediate: true, inPool: false }, posted);
  assert.equal((await ctx.prisma.order.findUniqueOrThrow({ where: { id: linkOnly.id } })).inPool, false);

  // Leaving within the hour, 先給常用司機 does not apply either.
  const soon = await ctx.orders.create(dispatcher, { ...sampleOrder, pickupAt: after(45).toISOString(), favoritesFirst: true }, posted);
  assert.equal(soon.favoritesOnlyUntil, null);

  const inPool = async (at: Date) => (await ctx.orders.pool(other, {}, at)).map((listed) => listed.code);
  assert.ok((await inPool(after(30))).includes(order.code), 'still listed after its time while nobody has it');
  assert.ok(!(await inPool(after(121))).includes(order.code), 'gone after 2 hours');

  const unclaimed = () => ctx.prisma.notification.findMany({ where: { userId: dispatcher, kind: 'ORDER_UNCLAIMED', orderId: order.id } });
  await ctx.notifications.list(dispatcher, after(9));
  assert.equal((await unclaimed()).length, 0);
  await ctx.notifications.list(dispatcher, after(12));
  await ctx.notifications.list(dispatcher, after(20));
  const lines = await unclaimed();
  assert.equal(lines.length, 1, 'once');
  assert.equal(lines[0].createdAt.toISOString(), after(10).toISOString());

  // A time set by hand makes it an ordinary order.
  const changed = await ctx.orders.updateTrip(dispatcher, order.id, { pickupAt: '2026-10-15T09:30:00+08:00' });
  assert.equal(changed.immediate, false);

  const trip = await ctx.orders.create(dispatcher, { ...transferOrder, immediate: true }, posted);
  const text = trip.share.dispatch.wechat.split('\n');
  assert.equal(text[0], '【即時・接駁】現在出發');
  assert.ok(text.some((line) => line.startsWith('第 1 段：現在出發')));
  assert.ok(text.some((line) => line.startsWith('第 2 段：10/15（四）16:00')));
});
