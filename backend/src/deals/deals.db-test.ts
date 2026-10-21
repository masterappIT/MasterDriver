import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { dealBookingCreateSchema, dealCreateSchema, type DealCreate } from '@masterdriver/shared';
import { createDriver, rejectsWith, seedPlans, setupDatabase, type TestContext } from '../test/database';

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

const HOUR = 3_600_000;
const iso = (date: Date) => date.toISOString().replace('Z', '+00:00');
const inHours = (hours: number) => new Date(Date.now() + hours * HOUR);

const deal = (overrides: Partial<Record<keyof DealCreate, unknown>> = {}) =>
  dealCreateSchema.parse({
    pickupAt: iso(inHours(24)),
    origin: '深圳灣口岸',
    destination: '香港國際機場',
    price: 350,
    currency: 'CNY',
    originalPrice: 500,
    maxPassengers: 6,
    maxLuggage: 6,
    ...overrides,
  });

let phone = 0;
const booking = (overrides: Record<string, unknown> = {}) => {
  phone += 1;
  return dealBookingCreateSchema.parse({
    pickupAt: iso(inHours(24)),
    passengers: 2,
    luggage: 2,
    passengerName: `乘客${phone}`,
    passengerContact: `+852 6${String(1000000 + phone).slice(-7)}`,
    ...overrides,
  });
};

/** 這單我自己做 from a deal booking, as the 詢價詳情 page sends it. */
async function driveMyself(userId: string, bookingId: string) {
  const row = await ctx.profilePages.booking(userId, bookingId);
  return ctx.orders.create(userId, {
    pickupAt: row.pickupAt,
    origin: row.origin,
    destination: row.destination,
    waypoints: [],
    passengers: row.passengers,
    luggage: row.luggage,
    passengerContact: row.passengerContact,
    passengerPrice: row.quote!,
    showPassengerPrice: true,
    selfDrive: true,
    bookingId,
  });
}

test('a deal needs driver details and a time ahead, and its text and link are ready to send', async () => {
  const noProfile = (await ctx.prisma.user.create({ data: { countryCode: '+852', phone: '90000001' } })).id;
  await rejectsWith(ctx.deals.create(noProfile, deal()), 'PROFILE_REQUIRED');
  const owner = await createDriver(ctx, '陳師傅');
  await rejectsWith(ctx.deals.create(owner, deal({ pickupAt: iso(inHours(-1)) })), 'DEAL_IN_THE_PAST');
  assert.throws(() => deal({ originalPrice: 300 }), /DEAL_ORIGINAL_NOT_ABOVE/);
  assert.throws(() => deal({ pickupUntil: iso(inHours(50)) }), /DEAL_WINDOW_INVALID/);

  const made = await ctx.deals.create(owner, deal());
  assert.equal(made.state, 'OPEN');
  assert.match(made.url, /^https:\/\/md\.test\/d\/[A-Za-z0-9]{10}$/);
  assert.match(made.share.wechat, /^【特價車】.+ 深圳灣口岸 → 香港國際機場\n整車 RMB¥350（原價 RMB¥500）\n最多 6 人、6 件行李\n陳師傅的特價車，點開預約，不用註冊：https/);
  assert.ok(await ctx.prisma.profilePage.findUnique({ where: { userId: owner } }), 'its bookings are kept under the driver’s 名片頁');
});

test('a booking waits for the driver at the deal price, which cannot be quoted again', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal());
  await rejectsWith(ctx.deals.createBooking(made.code, booking({ passengers: 7 }), '10.0.0.1'), 'DEAL_TOO_MANY_PASSENGERS');
  await rejectsWith(ctx.deals.createBooking(made.code, booking({ luggage: 7 }), '10.0.0.1'), 'DEAL_TOO_MUCH_LUGGAGE');

  // Without a 時段 the deal's own time stands, whatever the page sent.
  const sent = await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(30)), origin: '南山海岸城' }), '10.0.0.1');
  const seen = await ctx.profilePages.passengerBooking(sent.code);
  assert.equal(seen.status, 'PENDING');
  assert.equal(seen.pickupAt, made.pickupAt);
  assert.equal(seen.origin, '南山海岸城');
  assert.equal(seen.destination, '香港國際機場');
  assert.deepEqual(seen.quote, { amount: 350, currency: 'CNY' });
  assert.equal(seen.deal?.code, made.code);

  const [listed] = await ctx.profilePages.bookings(owner);
  await rejectsWith(ctx.profilePages.quote(owner, listed.id, { amount: 300, currency: 'CNY' }), 'DEAL_PRICE_FIXED');
  const samePhone = { ...booking(), passengerContact: listed.passengerContact };
  await rejectsWith(ctx.deals.createBooking(made.code, samePhone, '10.0.0.2'), 'DEAL_ALREADY_BOOKED');
  const notices = await ctx.notifications.list(owner);
  assert.equal(notices.items[0].kind, 'DEAL_BOOKING_NEW');
  assert.equal(notices.items[0].bookingId, listed.id);
});

test('making the order from one booking gives that party the deal and declines the others', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal());
  const first = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  const second = await ctx.deals.createBooking(made.code, booking(), '10.0.0.2');
  const secondId = (await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code: second.code } })).id;

  const order = await driveMyself(owner, secondId);
  assert.equal(order.selfDrive, true);
  assert.deepEqual(order.passengerPrice, { amount: 350, currency: 'CNY' });
  assert.equal((await ctx.deals.get(owner, made.id)).state, 'SOLD');
  assert.equal((await ctx.profilePages.passengerBooking(second.code)).status, 'ORDERED');
  assert.equal((await ctx.profilePages.passengerBooking(first.code)).status, 'DECLINED');
  await rejectsWith(ctx.deals.createBooking(made.code, booking(), '10.0.0.3'), 'DEAL_NOT_OPEN');
  await rejectsWith(ctx.deals.cancel(owner, made.id), 'DEAL_ORDERED');
});

test('自動接受第一組: the first booking gets the deal at once; letting go of it opens the deal again', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal({ autoAccept: true, pickupAt: iso(inHours(20)), pickupUntil: iso(inHours(24)) }));
  await rejectsWith(ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(25)) }), '10.0.0.1'), 'DEAL_TIME_OUTSIDE');

  const sent = await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(22)) }), '10.0.0.1');
  assert.equal((await ctx.profilePages.passengerBooking(sent.code)).status, 'ACCEPTED');
  assert.equal((await ctx.deals.get(owner, made.id)).state, 'SOLD');
  assert.equal((await ctx.deals.publicDeal(made.code)).state, 'SOLD');
  await rejectsWith(ctx.deals.createBooking(made.code, booking(), '10.0.0.2'), 'DEAL_NOT_OPEN');
  assert.equal((await ctx.notifications.list(owner)).items[0].kind, 'DEAL_SOLD');

  await ctx.profilePages.passengerCancel(sent.code);
  assert.equal((await ctx.deals.get(owner, made.id)).state, 'OPEN', 'the passenger let go of it');
  const again = await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(21)) }), '10.0.0.2');
  const againId = (await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code: again.code } })).id;
  await ctx.profilePages.decline(owner, againId);
  assert.equal((await ctx.deals.get(owner, made.id)).state, 'OPEN', 'the driver declined the party that had it');
});

test('two passengers booking at once with 自動接受第一組: exactly one gets the deal', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal({ autoAccept: true }));
  const race = await Promise.allSettled([
    ctx.deals.createBooking(made.code, booking(), '10.0.0.1'),
    ctx.deals.createBooking(made.code, booking(), '10.0.0.2'),
  ]);
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
});

test('下架 declines the parties still waiting; the platform’s staff can take one down with a reason', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal());
  const sent = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  const down = await ctx.deals.cancel(owner, made.id);
  assert.equal(down.state, 'CANCELLED');
  assert.equal((await ctx.profilePages.passengerBooking(sent.code)).status, 'DECLINED');
  await rejectsWith(ctx.deals.cancel(owner, made.id), 'DEAL_CANCELLED');
  await rejectsWith(ctx.deals.update(owner, made.id, { notes: '改一改' }), 'DEAL_NOT_OPEN');

  const other = await ctx.deals.create(owner, deal());
  await ctx.deals.staffCancel(owner, other.id, '內容不實');
  const [listed] = await ctx.deals.staffList(owner);
  assert.equal(listed.state, 'CANCELLED');
  assert.equal(listed.staffReason, '內容不實');
  assert.equal((await ctx.deals.get(owner, other.id)).staffReason, '內容不實');
});

test('changes apply to new bookings; one sent before keeps its time and price', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal());
  const sent = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  const changed = await ctx.deals.update(owner, made.id, { price: 300, originalPrice: null, notes: '可放嬰兒車' });
  assert.deepEqual(changed.price, { amount: 300, currency: 'CNY' });
  assert.equal(changed.originalPrice, null);
  assert.deepEqual((await ctx.profilePages.passengerBooking(sent.code)).quote, { amount: 350, currency: 'CNY' });
  await rejectsWith(ctx.deals.update(owner, made.id, { originalPrice: 200 }), 'DEAL_ORIGINAL_NOT_ABOVE');
});
