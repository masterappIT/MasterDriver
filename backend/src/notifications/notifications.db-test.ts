import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';

let ctx: TestContext;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 10);
});
after(async () => {
  ctx?.streams.onModuleDestroy();
  await ctx?.prisma.$disconnect();
});

const kinds = async (userId: string) => (await ctx.notifications.list(userId)).items.map((item) => item.kind).reverse();
const inDays = (days: number) => new Date(Date.now() + days * 86_400_000);
const iso = (date: Date) => date.toISOString().replace('Z', '+00:00');

test('each side of an order is told what the other side did, never what they did themselves', async () => {
  const dispatcher = await createDriver(ctx, '派單王');
  const driver = await createDriver(ctx, '陳師傅');
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  assert.deepEqual(await kinds(dispatcher), []);

  await ctx.orders.claim(order.code, driver);
  const view = await ctx.orders.getForParticipant(dispatcher, order.id);
  await ctx.orders.confirmByPassenger(view.links.passengerConfirm.split('/c/')[1]);
  await ctx.orders.confirmByPassenger(view.links.passengerConfirm.split('/c/')[1]);
  await ctx.orders.complete(driver, order.id);
  await ctx.orders.setSettlement(dispatcher, order.id, { settled: true });
  await ctx.orders.setSettlement(dispatcher, order.id, { settled: false });

  assert.deepEqual(await kinds(dispatcher), ['ORDER_CLAIMED', 'ORDER_CONFIRMED', 'ORDER_COMPLETED'], 'one 乘客確認 however often the passenger presses');
  assert.deepEqual(await kinds(driver), ['ORDER_SETTLED'], 'taking 已結清 back tells nobody');

  const first = (await ctx.notifications.list(dispatcher)).items.at(-1)!;
  assert.equal(first.orderId, order.id);
  assert.equal(first.summary, '深圳灣口岸 至 香港國際機場');
  assert.equal(first.pickupAt, new Date(sampleOrder.pickupAt).toISOString());
  assert.equal((await ctx.notifications.list(driver)).unread, 1);
  assert.equal((await ctx.notifications.list(dispatcher)).unread, 3);
});

test('cancelling and 改派 tell the driver; the platform cancelling also tells the dispatcher; a trip you drive yourself tells nobody', async () => {
  const dispatcher = await createDriver(ctx, '派單王');
  const driver = await createDriver(ctx, '陳師傅');
  const other = await createDriver(ctx, '李師傅');

  const reopened = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(reopened.code, driver);
  await ctx.orders.reopen(dispatcher, reopened.id);
  await ctx.orders.claim(reopened.code, other);
  await ctx.orders.cancel(dispatcher, reopened.id);
  assert.deepEqual(await kinds(driver), ['ORDER_REOPENED']);
  assert.deepEqual(await kinds(other), ['ORDER_CANCELLED']);

  const byStaff = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(byStaff.code, driver);
  await ctx.orders.cancelForStaff(dispatcher, byStaff.id);
  assert.deepEqual(await kinds(driver), ['ORDER_REOPENED', 'ORDER_CANCELLED']);
  assert.deepEqual(await kinds(dispatcher), ['ORDER_CLAIMED', 'ORDER_CLAIMED', 'ORDER_CLAIMED', 'ORDER_CANCELLED_BY_STAFF']);

  const unclaimed = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.cancel(dispatcher, unclaimed.id);
  const own = await ctx.orders.create(dispatcher, { ...sampleOrder, selfDrive: true });
  await ctx.orders.complete(dispatcher, own.id);
  assert.equal((await ctx.notifications.list(dispatcher)).items.length, 4, 'no driver to tell');

  // The driver marking done tells the dispatcher; the dispatcher marking done tells the driver.
  const done = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(done.code, other);
  await ctx.orders.complete(dispatcher, done.id);
  assert.deepEqual(await kinds(other), ['ORDER_CANCELLED', 'ORDER_COMPLETED']);
});

test("可以看乘客電話了 is written once per claim, when the driver's notifications are read after the reveal time", async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const pickupAt = inDays(3);
  const order = await ctx.orders.create(dispatcher, { ...sampleOrder, pickupAt: iso(pickupAt), contactRevealMinutes: 60 });
  await ctx.orders.claim(order.code, driver);

  const before = new Date(pickupAt.getTime() - 61 * 60_000);
  const afterReveal = new Date(pickupAt.getTime() - 30 * 60_000);
  assert.equal((await ctx.notifications.list(driver, before)).items.length, 0);
  await ctx.notifications.list(driver, afterReveal);
  const { items } = await ctx.notifications.list(driver, afterReveal);
  assert.deepEqual(items.map((item) => item.kind), ['CONTACT_REVEALED']);
  assert.equal(items[0].createdAt, new Date(pickupAt.getTime() - 60 * 60_000).toISOString(), 'dated at the reveal time');

  // Given back and claimed again: told again for the new claim.
  await ctx.orders.reopen(dispatcher, order.id);
  await ctx.orders.claim(order.code, driver);
  await ctx.notifications.revealDue(driver, afterReveal);
  assert.deepEqual(await kinds(driver), ['ORDER_REOPENED', 'CONTACT_REVEALED', 'CONTACT_REVEALED']);

  // Shown from the claim on: nothing to tell.
  const atOnce = await ctx.orders.create(dispatcher, { ...sampleOrder, pickupAt: iso(pickupAt), contactRevealMinutes: null });
  const other = await createDriver(ctx);
  await ctx.orders.claim(atOnce.code, other);
  await ctx.notifications.revealDue(other, afterReveal);
  assert.deepEqual(await kinds(other), []);
});

test('the 名片頁 owner hears of new bookings and the passenger answering', async () => {
  const owner = await createDriver(ctx, '陳師傅');
  const page = await ctx.profilePages.update(owner, { published: true });
  const request = {
    pickupAt: iso(inDays(7)),
    origin: '香港國際機場',
    destination: '深圳灣口岸',
    passengers: 2,
    luggage: 1,
    passengerContact: 'wechat: wang-test',
  };
  const accepted = await ctx.profilePages.createBooking(page.code, request, '2.2.2.2');
  const [booking] = await ctx.profilePages.bookings(owner);
  await ctx.profilePages.quote(owner, booking.id, { amount: 800, currency: 'HKD' });
  await ctx.profilePages.passengerAccept(accepted.code);
  const cancelled = await ctx.profilePages.createBooking(page.code, request, '2.2.2.2');
  await ctx.profilePages.passengerCancel(cancelled.code);

  assert.deepEqual(await kinds(owner), ['BOOKING_NEW', 'BOOKING_ACCEPTED', 'BOOKING_NEW', 'BOOKING_CANCELLED']);
  const latest = (await ctx.notifications.list(owner)).items[0];
  assert.equal(latest.summary, '香港國際機場 至 深圳灣口岸');
  assert.ok(latest.bookingId);
});

test('客服 replies make one line until read; opening the conversation reads it', async () => {
  const user = await createDriver(ctx);
  const { password } = await ctx.adminAuth.createAccount({ username: 'ops', displayName: '營運小陳', role: 'OPERATOR' }, null);
  const { token } = await ctx.adminAuth.login({ username: 'ops', password }, undefined, undefined);
  const admin = (await ctx.adminAuth.resolveSession(token))!;
  const { id } = await ctx.support.openForUser(user, admin);

  await ctx.support.staffSendText(id, admin, { text: '你好', clientMessageId: 'client-msg-a1' });
  await ctx.support.staffSendText(id, admin, { text: '請問有甚麼可以幫你', clientMessageId: 'client-msg-a2' });
  assert.deepEqual(await kinds(user), ['SUPPORT_REPLY']);

  await ctx.support.thread({ type: 'USER', userId: user }, {});
  assert.equal((await ctx.notifications.list(user)).unread, 0);
  await ctx.support.staffSendText(id, admin, { text: '還有問題嗎', clientMessageId: 'client-msg-a3' });
  assert.deepEqual(await kinds(user), ['SUPPORT_REPLY', 'SUPPORT_REPLY'], 'a reply after reading is a new line');
});

test('a group turned off records nothing; lines are read one by one or all at once', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  assert.deepEqual(await ctx.notifications.saveSettings(dispatcher, { off: ['DISPATCHED', 'DISPATCHED'] }), { off: ['DISPATCHED'] });

  const first = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(first.code, driver);
  assert.deepEqual(await kinds(dispatcher), []);

  await ctx.notifications.saveSettings(dispatcher, { off: [] });
  for (let index = 0; index < 3; index += 1) {
    const order = await ctx.orders.create(dispatcher, sampleOrder);
    await ctx.orders.claim(order.code, driver);
  }
  const { items } = await ctx.notifications.list(dispatcher);
  assert.deepEqual(await ctx.notifications.markRead(dispatcher, { id: items[0].id }), { unread: 2 });
  assert.deepEqual(await ctx.notifications.markRead(driver, { id: items[1].id }), { unread: 0 }, 'not their line');
  assert.equal((await ctx.notifications.list(dispatcher)).unread, 2);
  assert.deepEqual(await ctx.notifications.markRead(dispatcher, { all: true }), { unread: 0 });
});
