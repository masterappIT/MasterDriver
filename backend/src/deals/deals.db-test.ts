import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { dealBookingCreateSchema, dealCreateSchema, type DealCreate } from '@masterdriver/shared';
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

/** An order of the driver's own with a pickup still ahead. */
const sampleOrderFor = () => ({ ...sampleOrder, pickupAt: iso(inHours(48)) });

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
  assert.throws(() => deal({ pickupUntil: iso(inHours(24 + 8 * 24)) }), /DEAL_WINDOW_INVALID/, 'a 時段 is at most 7 days');
  assert.ok(deal({ pickupUntil: iso(inHours(24 + 6 * 24)) }), 'a week-long 時段 is fine');

  const made = await ctx.deals.create(owner, deal());
  assert.equal(made.state, 'OPEN');
  assert.equal(made.left, null, 'no limit unless 最多接幾組 is set');
  assert.match(made.url, /^https:\/\/md\.test\/d\/[A-Za-z0-9]{10}$/);
  assert.match(made.share.wechat, /^【特價車】.+ 深圳灣口岸 → 香港國際機場\n包車 RMB¥350（原價 RMB¥500）\n最多 6 人、6 件行李\n陳師傅的特價車，點開預約，不用註冊：https/);
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

  assert.deepEqual(await ctx.profilePages.bookings(owner), [], '等我報價 lists 名片頁 requests only');
  assert.deepEqual(await ctx.profilePages.unread(owner), { count: 0, deals: 1 });
  const listed = await ctx.profilePages.booking(owner, (await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code: sent.code } })).id);
  assert.deepEqual(await ctx.profilePages.unread(owner), { count: 0, deals: 1 }, 'opened, it still waits on the driver');
  await rejectsWith(ctx.profilePages.quote(owner, listed.id, { amount: 300, currency: 'CNY' }), 'DEAL_PRICE_FIXED');
  const samePhone = { ...booking(), passengerContact: listed.passengerContact };
  await rejectsWith(ctx.deals.createBooking(made.code, samePhone, '10.0.0.2'), 'DEAL_ALREADY_BOOKED');
  const notices = await ctx.notifications.list(owner);
  assert.equal(notices.items[0].kind, 'DEAL_BOOKING_NEW');
  assert.equal(notices.items[0].bookingId, listed.id);
});

test('like a product, any number of parties book it, each made into its own order', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal({ pickupAt: iso(inHours(20)), pickupUntil: iso(inHours(20 + 5 * 24)) }));
  await rejectsWith(ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(20 + 6 * 24)) }), '10.0.0.1'), 'DEAL_TIME_OUTSIDE');
  const first = await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(22)) }), '10.0.0.1');
  const second = await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(50)) }), '10.0.0.2');
  // The same passenger may book it again for another time.
  const firstRow = await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code: first.code } });
  await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(70)), passengerContact: firstRow.passengerContact }), '10.0.0.3');
  const secondId = (await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code: second.code } })).id;

  const order = await driveMyself(owner, secondId);
  assert.equal(order.selfDrive, true);
  assert.deepEqual(order.passengerPrice, { amount: 350, currency: 'CNY' });
  assert.equal((await ctx.profilePages.passengerBooking(second.code)).status, 'ORDERED');
  assert.equal((await ctx.profilePages.passengerBooking(first.code)).status, 'PENDING', 'the others are not touched');
  await driveMyself(owner, firstRow.id);
  const view = await ctx.deals.get(owner, made.id);
  assert.equal(view.state, 'OPEN', 'it keeps taking bookings');
  assert.equal(view.ordered, 2);
  assert.equal(view.waiting, 1);
  await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(90)) }), '10.0.0.4');
});

test('自動接受: each booking is accepted as it comes, and the deal stays open', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal({ autoAccept: true }));
  const first = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  const second = await ctx.deals.createBooking(made.code, booking(), '10.0.0.2');
  assert.equal((await ctx.profilePages.passengerBooking(first.code)).status, 'ACCEPTED');
  assert.equal((await ctx.profilePages.passengerBooking(second.code)).status, 'ACCEPTED');
  const view = await ctx.deals.get(owner, made.id);
  assert.equal(view.state, 'OPEN');
  assert.equal(view.toOrder, 2);
  assert.equal((await ctx.notifications.list(owner)).items[0].kind, 'DEAL_BOOKING_ACCEPTED');
});

test('最多接幾組: full once that many parties hold a booking; one let go frees its place', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal({ maxBookings: 2 }));
  const first = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  await ctx.deals.createBooking(made.code, booking(), '10.0.0.2');
  assert.equal((await ctx.deals.publicDeal(made.code)).state, 'FULL');
  assert.equal((await ctx.deals.get(owner, made.id)).left, 0);
  await rejectsWith(ctx.deals.createBooking(made.code, booking(), '10.0.0.3'), 'DEAL_FULL');
  await rejectsWith(ctx.deals.update(owner, made.id, { maxBookings: 1 }), 'DEAL_MAX_BELOW_BOOKED');

  await ctx.profilePages.passengerCancel(first.code);
  assert.equal((await ctx.deals.publicDeal(made.code)).state, 'OPEN');
  await ctx.deals.createBooking(made.code, booking(), '10.0.0.3');
});

test('two passengers booking the last place at once: exactly one gets it', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal({ maxBookings: 1 }));
  const race = await Promise.allSettled([
    ctx.deals.createBooking(made.code, booking(), '10.0.0.1'),
    ctx.deals.createBooking(made.code, booking(), '10.0.0.2'),
  ]);
  assert.equal(race.filter((result) => result.status === 'fulfilled').length, 1);
});

test('關閉 stops new bookings; the ones sent are still made into orders', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal());
  const sent = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  const closed = await ctx.deals.close(owner, made.id);
  assert.equal(closed.state, 'CLOSED');
  await rejectsWith(ctx.deals.createBooking(made.code, booking(), '10.0.0.2'), 'DEAL_NOT_OPEN');
  await rejectsWith(ctx.deals.close(owner, made.id), 'DEAL_NOT_OPEN');
  await rejectsWith(ctx.deals.update(owner, made.id, { notes: '改一改' }), 'DEAL_NOT_OPEN');
  assert.equal((await ctx.profilePages.passengerBooking(sent.code)).status, 'PENDING');
  await driveMyself(owner, (await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code: sent.code } })).id);
  assert.equal((await ctx.profilePages.passengerBooking(sent.code)).status, 'ORDERED');
});

test('the platform’s staff take one down with a reason: waiting parties are declined, orders stay', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal());
  const ordered = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  const waiting = await ctx.deals.createBooking(made.code, booking(), '10.0.0.2');
  await driveMyself(owner, (await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code: ordered.code } })).id);

  await ctx.deals.staffCancel(owner, made.id, '內容不實');
  assert.equal((await ctx.profilePages.passengerBooking(waiting.code)).status, 'DECLINED');
  assert.equal((await ctx.profilePages.passengerBooking(ordered.code)).status, 'ORDERED');
  const [listed] = await ctx.deals.staffList(owner);
  assert.equal(listed.state, 'CANCELLED');
  assert.equal(listed.ordered, 1);
  assert.equal(listed.staffReason, '內容不實');
  assert.equal((await ctx.deals.get(owner, made.id)).staffReason, '內容不實');
  await rejectsWith(ctx.deals.staffCancel(owner, made.id, '再一次'), 'DEAL_CANCELLED');
});

test('changes apply to new bookings; one sent before keeps its time and price', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal());
  const sent = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  const changed = await ctx.deals.update(owner, made.id, { price: 300, originalPrice: null, notes: '可放嬰兒車', maxBookings: 5 });
  assert.deepEqual(changed.price, { amount: 300, currency: 'CNY' });
  assert.equal(changed.originalPrice, null);
  assert.equal(changed.left, 4);
  assert.deepEqual((await ctx.profilePages.passengerBooking(sent.code)).quote, { amount: 350, currency: 'CNY' });
  await rejectsWith(ctx.deals.update(owner, made.id, { originalPrice: 200 }), 'DEAL_ORIGINAL_NOT_ABOVE');
});

test('特價車 bookings have limits of their own: by phone, not held back by the 名片頁 limits', async () => {
  const owner = await createDriver(ctx);
  await ctx.prisma.limitSetting.create({ data: { id: 'default', bookingPerIpPerDay: 1, bookingPerPagePerDay: 1, dealBookingPerPhonePerDay: 2 } });
  const made = await ctx.deals.create(owner, deal({ pickupAt: iso(inHours(20)), pickupUntil: iso(inHours(60)) }));
  // Many passengers on one address (a mainland mobile network) all get through.
  for (let i = 0; i < 4; i += 1) await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(21 + i)) }), '10.0.0.1');
  const one = booking({ pickupAt: iso(inHours(30)) });
  await ctx.deals.createBooking(made.code, one, '10.0.0.2');
  await ctx.deals.createBooking(made.code, { ...one, pickupAt: iso(inHours(31)) }, '10.0.0.3');
  await rejectsWith(ctx.deals.createBooking(made.code, { ...one, pickupAt: iso(inHours(32)) }, '10.0.0.4'), 'DEAL_PHONE_LIMIT');

  // The 名片頁 still takes its own requests: the deal bookings are not counted against it.
  await ctx.profilePages.update(owner, { published: true });
  const page = await ctx.prisma.profilePage.findUniqueOrThrow({ where: { userId: owner } });
  await ctx.profilePages.createBooking(
    page.code,
    { pickupAt: iso(inHours(40)), origin: '深圳灣口岸', destination: '香港國際機場', passengers: 1, luggage: 0, transfer: false, roundTrip: false, passengerName: '名片客', passengerContact: '+852 61119999' },
    '10.0.0.1',
  );
});

test('特價車 the driver drives themselves uses no quota; handed to another driver, it uses one then', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal());
  const used = async () => (await ctx.prisma.usage.findFirst({ where: { userId: owner, featureKey: 'order.create' } }))?.used ?? 0;
  const sent = await ctx.deals.createBooking(made.code, booking(), '10.0.0.1');
  const order = await driveMyself(owner, (await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code: sent.code } })).id);
  assert.equal(await used(), 0);
  await ctx.orders.reopen(owner, order.id);
  assert.equal(await used(), 1, '交給別的司機 puts it out like any order');
  // A 名片頁 request driven by the driver still counts, as before.
  await ctx.orders.create(owner, { ...sampleOrderFor(), selfDrive: true });
  assert.equal(await used(), 2);
});

test('時間相近: a booking close to the driver’s own trip or another waiting booking is flagged', async () => {
  const owner = await createDriver(ctx);
  const made = await ctx.deals.create(owner, deal({ pickupAt: iso(inHours(20)), pickupUntil: iso(inHours(60)) }));
  const first = await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(30)) }), '10.0.0.1');
  const near = await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(31)) }), '10.0.0.2');
  const far = await ctx.deals.createBooking(made.code, booking({ pickupAt: iso(inHours(50)) }), '10.0.0.3');
  const idOf = async (code: string) => (await ctx.prisma.bookingRequest.findUniqueOrThrow({ where: { code } })).id;
  const flags = Object.fromEntries((await ctx.deals.get(owner, made.id)).bookings.map((line) => [line.id, line.clash]));
  assert.equal(flags[await idOf(first.code)], true);
  assert.equal(flags[await idOf(near.code)], true);
  assert.equal(flags[await idOf(far.code)], false);

  // Once the first is the driver's own trip, the near one is still flagged against it.
  await driveMyself(owner, await idOf(first.code));
  const opened = await ctx.profilePages.booking(owner, await idOf(near.code));
  assert.deepEqual(opened.nearby.map((trip) => trip.kind), ['ORDER']);
  assert.deepEqual((await ctx.profilePages.booking(owner, await idOf(far.code))).nearby, []);
});
