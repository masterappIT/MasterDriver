import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, rejectsWith, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';

let ctx: TestContext;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 100);
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]).toString('base64')}`;
const fps = { kind: 'FPS' as const, label: '轉數快', account: 'FPS ID 1234567' };
const wechat = { kind: 'WECHAT' as const, label: '微信收款', qrImage: png };
/** The passenger's confirmation code of an order (the app only gets the link). */
const confirmOf = async (id: string) => (await ctx.prisma.order.findUniqueOrThrow({ where: { id }, select: { confirmCode: true } })).confirmCode;

test('收款方式: account details or a QR, at most five, each only its owner’s', async () => {
  const owner = await createDriver(ctx);
  const listed = await ctx.paymentMethods.create(owner, fps);
  assert.equal(listed.length, 1);
  assert.equal(listed[0].account, 'FPS ID 1234567');
  assert.equal(listed[0].qrUrl, null);

  const withQr = await ctx.paymentMethods.create(owner, wechat);
  assert.match(withQr[1].qrUrl ?? '', /^\/api\/me\/payment-methods\/.+\/qr\?v=\d+$/);
  assert.ok(await ctx.paymentMethods.ownQr(owner, withQr[1].id));

  await rejectsWith(ctx.paymentMethods.create(owner, { kind: 'WECHAT', label: '壞圖', qrImage: 'data:image/png;base64,AAAA' }), 'QR_IMAGE_INVALID');
  await rejectsWith(ctx.paymentMethods.update(owner, withQr[1].id, { qrImage: null }), 'PAYMENT_METHOD_EMPTY');
  for (let i = 0; i < 3; i += 1) await ctx.paymentMethods.create(owner, fps);
  await rejectsWith(ctx.paymentMethods.create(owner, fps), 'PAYMENT_METHOD_LIMIT');

  const other = await createDriver(ctx);
  assert.equal(await ctx.paymentMethods.ownQr(other, withQr[1].id), null);
  await rejectsWith(ctx.paymentMethods.remove(other, withQr[1].id), 'PAYMENT_METHOD_NOT_FOUND');
  assert.equal((await ctx.paymentMethods.remove(owner, listed[0].id)).length, 4);
});

test('the passenger sees how to pay only when the order shows it; QR images only through that link', async () => {
  const dispatcher = await createDriver(ctx, '陳師傅');
  const [method] = await ctx.paymentMethods.create(dispatcher, wechat);
  const hidden = await confirmOf((await ctx.orders.create(dispatcher, { ...sampleOrder, passengerPrice: { amount: 800, currency: 'HKD' } })).id);
  assert.equal((await ctx.orders.getForPassenger(hidden)).payment, null, 'off by default');
  assert.equal(await ctx.paymentMethods.passengerQr(hidden, method.id), null);

  const shown = await ctx.orders.create(dispatcher, { ...sampleOrder, passengerPrice: { amount: 800, currency: 'HKD' }, showPaymentMethods: true });
  const shownCode = await confirmOf(shown.id);
  const page = await ctx.orders.getForPassenger(shownCode);
  assert.deepEqual(page.payment?.amount, { amount: 800, currency: 'HKD' });
  assert.equal(page.payment?.payee, '陳師傅');
  assert.equal(page.payment?.paid, false);
  assert.match(page.payment?.methods[0].qrUrl ?? '', new RegExp(`^/api/c/${shownCode}/payment-methods/`));
  assert.ok(await ctx.paymentMethods.passengerQr(shownCode, method.id));

  // Someone else's method cannot be fetched through this order's link.
  const [foreign] = await ctx.paymentMethods.create(await createDriver(ctx), wechat);
  assert.equal(await ctx.paymentMethods.passengerQr(shownCode, foreign.id), null);

  await ctx.orders.cancel(dispatcher, shown.id);
  assert.equal((await ctx.orders.getForPassenger(shownCode)).payment, null, 'not on a cancelled order');
  assert.equal(await ctx.paymentMethods.passengerQr(shownCode, method.id), null);
});

test('已收款 is the dispatcher’s mark; a 接駁 trip is paid once, and a new leg follows the trip', async () => {
  const dispatcher = await createDriver(ctx);
  await ctx.paymentMethods.create(dispatcher, fps);
  const first = await ctx.orders.create(dispatcher, {
    ...sampleOrder,
    destination: '港珠澳大橋香港口岸',
    transfer: true,
    passengerPrice: { amount: 500, currency: 'HKD' },
    showPaymentMethods: true,
  });
  const second = await ctx.orders.create(dispatcher, {
    ...sampleOrder,
    pickupAt: '2026-10-15T16:00:00+08:00',
    origin: '港珠澳大橋香港口岸',
    destination: '澳門',
    passengerPrice: { amount: 300, currency: 'HKD' },
    afterOrderId: first.id,
  });
  const leg = await ctx.prisma.order.findUniqueOrThrow({ where: { id: second.id } });
  assert.equal(leg.showPaymentMethods, true, 'the new leg follows the trip');
  assert.deepEqual((await ctx.orders.getForPassenger(await confirmOf(first.id))).payment?.amount, { amount: 800, currency: 'HKD' }, 'one amount for the trip');

  await rejectsWith(ctx.orders.setPayment(await createDriver(ctx), first.id, { paid: true }), 'ORDER_NOT_FOUND');
  const marked = await ctx.orders.setPayment(dispatcher, second.id, { paid: true });
  assert.ok('paidAt' in marked && marked.paidAt);
  const legs = await ctx.prisma.order.findMany({ where: { journeyId: first.id }, select: { paidAt: true } });
  assert.ok(legs.every((one) => one.paidAt), 'every leg of the trip is marked');
  assert.equal((await ctx.orders.getForPassenger(await confirmOf(first.id))).payment?.paid, true);

  await ctx.orders.setPayment(dispatcher, first.id, { paid: false, showPaymentMethods: false });
  assert.equal((await ctx.orders.getForPassenger(await confirmOf(first.id))).payment, null);
  assert.equal((await ctx.prisma.order.findUniqueOrThrow({ where: { id: second.id } })).paidAt, null);
});
