import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { carpoolCreateSchema, carpoolSeatCreateSchema, type CarpoolCreate } from '@masterdriver/shared';
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
const inHours = (hours: number, from = new Date()) => new Date(from.getTime() + hours * HOUR);

/** A driver with a 7-seat car: six seats for passengers. */
async function driver(name = '陳師傅', seats = 7) {
  const id = await createDriver(ctx, name);
  await ctx.prisma.driverProfile.update({ where: { userId: id }, data: { seats, vehicleType: '7座' } });
  return id;
}

const carpool = (overrides: Partial<Record<keyof CarpoolCreate, unknown>> = {}) =>
  carpoolCreateSchema.parse({
    pickupAt: iso(inHours(24)),
    origin: '深圳灣口岸',
    destination: '香港國際機場',
    pickupPoints: ['深圳灣口岸', '南山海岸城'],
    seats: 4,
    minPassengers: 3,
    seatPrice: { amount: 200, currency: 'HKD' },
    luggagePerSeat: 1,
    ...overrides,
  });

let phone = 0;
const seat = (overrides: Record<string, unknown> = {}) => {
  phone += 1;
  return carpoolSeatCreateSchema.parse({
    passengers: 1,
    luggage: 1,
    pickupPoint: '深圳灣口岸',
    passengerName: `乘客${phone}`,
    passengerContact: `+852 6${String(1000000 + phone).slice(-7)}`,
    ...overrides,
  });
};

test('a carpool needs the car\'s seats, keeps the driver\'s own, and closes by default two hours before pickup', async () => {
  const noSeats = await createDriver(ctx);
  await rejectsWith(ctx.carpools.create(noSeats, carpool()), 'CARPOOL_SEATS_REQUIRED');
  const owner = await driver();
  await rejectsWith(ctx.carpools.create(owner, carpool({ seats: 7 })), 'CARPOOL_TOO_MANY_SEATS');
  await rejectsWith(ctx.carpools.create(owner, carpool({ minPassengers: 5 })), 'CARPOOL_MIN_OVER_SEATS');
  await rejectsWith(ctx.carpools.create(owner, carpool({ pickupAt: iso(inHours(-1)) })), 'CARPOOL_IN_THE_PAST');

  const made = await ctx.carpools.create(owner, carpool({ seats: 6 }));
  assert.equal(made.status, 'OPEN');
  assert.equal(new Date(made.pickupAt).getTime() - new Date(made.closesAt).getTime(), 2 * HOUR);
  assert.match(made.url, /^https:\/\/md\.test\/r\/[A-Za-z0-9]{10}$/);
  assert.match(made.share.wechat, /^【拼車】.+ 深圳灣口岸 → 香港國際機場\n上車點：深圳灣口岸、南山海岸城\n每位 HK\$200｜每位 1 件行李\n還差 3 位成行，剩 6 位\n報位：https/);
});

test('seats wait for the driver, hold the car, and the last seats go to one party only', async () => {
  const owner = await driver();
  const made = await ctx.carpools.create(owner, carpool());

  const first = await ctx.carpools.createSeat(made.code, seat({ passengers: 2, luggage: 2 }), '10.0.0.1');
  let view = await ctx.carpools.passengerSeat(first.code);
  assert.equal(view.seat.status, 'PENDING');
  assert.equal(view.left, 2, 'a seat waiting for the driver holds its seats');
  assert.equal(view.driver, null, 'no phones before the driver confirms');
  assert.deepEqual(view.seat.price, { amount: 400, currency: 'HKD' });

  await rejectsWith(ctx.carpools.createSeat(made.code, seat({ pickupPoint: '福田' }), '10.0.0.2'), 'CARPOOL_PICKUP_POINT');
  await rejectsWith(ctx.carpools.createSeat(made.code, seat({ luggage: 2 }), '10.0.0.2'), 'CARPOOL_TOO_MUCH_LUGGAGE');
  const samePhone = { ...seat(), passengerContact: (await ctx.prisma.carpoolSeat.findFirstOrThrow()).passengerContact };
  await rejectsWith(ctx.carpools.createSeat(made.code, samePhone, '10.0.0.2'), 'CARPOOL_ALREADY_BOOKED');

  // Two parties ask for the last two seats at once: exactly one gets them.
  const race = await Promise.allSettled([
    ctx.carpools.createSeat(made.code, seat({ passengers: 2, luggage: 0 }), '10.0.0.3'),
    ctx.carpools.createSeat(made.code, seat({ passengers: 2, luggage: 0 }), '10.0.0.4'),
  ]);
  assert.equal(race.filter((one) => one.status === 'fulfilled').length, 1);
  const lost = race.find((one) => one.status === 'rejected') as PromiseRejectedResult;
  assert.equal(lost.reason.response.code, 'CARPOOL_NOT_ENOUGH_SEATS');

  const own = await ctx.carpools.get(owner, made.id);
  assert.equal(own.left, 0);
  assert.equal(own.waiting, 2);
  assert.equal(own.seatsList[0].passengerContact, null, 'the driver sees a phone once they confirm');
  assert.equal((await ctx.carpools.unread(owner)).count, 0, 'opening the carpool reads its seats');

  await ctx.carpools.confirmSeat(owner, made.id, own.seatsList[0].id);
  view = await ctx.carpools.passengerSeat(first.code);
  assert.equal(view.seat.status, 'CONFIRMED');
  assert.equal(view.driver?.name, '陳師傅');
  assert.ok(view.driver?.phones.length);
  assert.equal(view.short, 1, '2 of the 3 it goes with');

  const kinds = (await ctx.notifications.list(owner)).items.map((item) => item.kind);
  assert.deepEqual(kinds.sort(), ['CARPOOL_SEAT_WAITING', 'CARPOOL_SEAT_WAITING']);
});

test('a seat the driver does not answer runs out and frees its seats', async () => {
  const owner = await driver();
  const made = await ctx.carpools.create(owner, carpool({ seats: 2, minPassengers: 2 }));
  const now = new Date();
  const asked = await ctx.carpools.createSeat(made.code, seat({ passengers: 2, luggage: 0 }), undefined, now);
  await rejectsWith(ctx.carpools.createSeat(made.code, seat(), undefined, now), 'CARPOOL_NOT_ENOUGH_SEATS');
  const later = inHours(2.1, now);
  const view = await ctx.carpools.passengerSeat(asked.code, later);
  assert.equal(view.seat.status, 'EXPIRED');
  assert.equal(view.left, 2);
  const seatId = (await ctx.prisma.carpoolSeat.findFirstOrThrow()).id;
  await rejectsWith(ctx.carpools.confirmSeat(owner, made.id, seatId, later), 'CARPOOL_SEAT_NOT_PENDING');
});

test('auto-confirmed seats form the carpool once; a new price asks every party again', async () => {
  const owner = await driver();
  const made = await ctx.carpools.create(owner, carpool({ autoConfirm: true, minPassengers: 2 }));
  const a = await ctx.carpools.createSeat(made.code, seat(), undefined);
  const b = await ctx.carpools.createSeat(made.code, seat(), undefined);
  assert.equal((await ctx.carpools.passengerSeat(a.code)).seat.status, 'CONFIRMED');
  let own = await ctx.carpools.get(owner, made.id);
  assert.ok(own.formedAt);
  assert.equal(own.confirmed, 2);

  own = await ctx.carpools.update(owner, made.id, { seatPrice: { amount: 250, currency: 'HKD' } });
  assert.equal(own.unaccepted, 2);
  assert.equal(own.confirmed, 0, 'not counted until they accept');
  assert.equal(own.formedAt, null);
  assert.equal((await ctx.carpools.passengerSeat(b.code)).seat.reconfirm, true);
  await ctx.carpools.passengerReconfirm(a.code);
  await ctx.carpools.passengerReconfirm(b.code);
  own = await ctx.carpools.get(owner, made.id);
  assert.ok(own.formedAt);

  const formed = (await ctx.notifications.list(owner)).items.filter((item) => item.kind === 'CARPOOL_FORMED');
  assert.equal(formed.length, 2, 'formed, dropped below on the new price, formed again');
});

test('closing, then the driver drives it: one order for every confirmed party, each reported on its own', async () => {
  const owner = await driver();
  const made = await ctx.carpools.create(owner, carpool({ autoConfirm: true, waitMinutes: 10 }));
  const a = await ctx.carpools.createSeat(made.code, seat({ passengers: 2, luggage: 2 }), undefined);
  const b = await ctx.carpools.createSeat(made.code, seat({ pickupPoint: '南山海岸城', dropoff: '東涌' }), undefined);
  await rejectsWith(ctx.carpools.start(owner, made.id, { mode: 'SELF' }), 'CARPOOL_STILL_OPEN');
  await ctx.carpools.close(owner, made.id);
  await rejectsWith(ctx.carpools.createSeat(made.code, seat(), undefined), 'CARPOOL_CLOSED');

  const { orderId } = await ctx.carpools.start(owner, made.id, { mode: 'SELF' });
  await rejectsWith(ctx.carpools.start(owner, made.id, { mode: 'SELF' }), 'CARPOOL_NOT_OPEN');
  const order = await ctx.orders.getForParticipant(owner, orderId);
  assert.equal(order.status, 'ASSIGNED');
  assert.equal(order.passengers, 3);
  assert.equal(order.luggage, 3);
  assert.ok(order.passengerConfirmedAt);
  assert.deepEqual(order.carpool?.stops, ['深圳灣口岸', '南山海岸城']);
  assert.deepEqual(order.carpool?.parties.map((party) => party.dropoff), ['香港國際機場', '東涌']);
  assert.deepEqual(order.carpool?.parties.map((party) => party.price), [{ amount: 400, currency: 'HKD' }, { amount: 200, currency: 'HKD' }]);
  assert.equal((await ctx.prisma.usage.findFirstOrThrow()).used, 1, 'a quota like any order');
  await rejectsWith(ctx.orders.updateTrip(owner, orderId, { notes: '改' }), 'CARPOOL_TRIP_FIXED');
  await rejectsWith(ctx.orders.progress(owner, orderId, { step: 'ARRIVED' }), 'CARPOOL_PROGRESS_BY_PARTY');

  const [first, second] = order.carpool!.parties.map((party) => party.id as string);
  const now = new Date();
  await ctx.orders.progress(owner, orderId, { step: 'DEPARTED' }, now);
  await ctx.orders.partyProgress(owner, orderId, first, { step: 'ARRIVED' }, now);
  await rejectsWith(ctx.orders.partyProgress(owner, orderId, first, { step: 'NO_SHOW' }, inHours(0.1, now)), 'CARPOOL_WAIT_FIRST');
  await ctx.orders.partyProgress(owner, orderId, first, { step: 'PICKED_UP' }, inHours(0.1, now));
  let view = await ctx.orders.getForParticipant(owner, orderId);
  assert.ok(view.progress?.arrivedAt);
  assert.equal(view.progress?.pickedUpAt, null, 'one party still to pick up');
  await ctx.orders.partyProgress(owner, orderId, second, { step: 'ARRIVED' }, inHours(0.2, now));
  await ctx.orders.partyProgress(owner, orderId, second, { step: 'NO_SHOW' }, inHours(0.4, now));
  view = await ctx.orders.getForParticipant(owner, orderId);
  assert.ok(view.progress?.pickedUpAt, 'every party on board or not there');
  await rejectsWith(ctx.orders.partyProgress(owner, orderId, second, { step: 'PICKED_UP' }), 'CARPOOL_PARTY_NO_SHOW');
  await rejectsWith(ctx.carpools.passengerCancel(a.code), 'CARPOOL_SEAT_CLOSED');

  const passenger = await ctx.carpools.passengerSeat(b.code);
  assert.ok(passenger.seat.progress.noShowAt);
  assert.ok(passenger.seat.progress.departedAt);

  await ctx.orders.partyPayment(owner, orderId, first, { paid: true });
  assert.equal((await ctx.carpools.passengerSeat(a.code)).payment, null, 'ways to pay only when the carpool shows them');
  view = await ctx.orders.getForParticipant(owner, orderId);
  assert.ok(view.carpool?.parties[0].paidAt);
  const book = await ctx.orders.passengers(owner);
  assert.equal(book.length, 2, 'each party is a passenger in the book');
});

test('put out for another driver: the group text has no passenger, the taker sees the parties, and a party leaving tells them', async () => {
  const owner = await driver();
  const taker = await driver('李師傅');
  const made = await ctx.carpools.create(owner, carpool({ autoConfirm: true, showPaymentMethods: true }));
  const a = await ctx.carpools.createSeat(made.code, seat({ passengers: 2, luggage: 0 }), undefined);
  const b = await ctx.carpools.createSeat(made.code, seat(), undefined);
  await ctx.carpools.close(owner, made.id);
  const { orderId } = await ctx.carpools.start(owner, made.id, {
    mode: 'DISPATCH',
    driverPrice: { amount: 500, currency: 'HKD' },
    vehicleType: '7座',
    inPool: true,
    contactRevealMinutes: null,
  });
  const dispatched = await ctx.orders.getForParticipant(owner, orderId);
  assert.equal(dispatched.status, 'OPEN');
  const text = (dispatched as { share: { dispatch: { wechat: string } } }).share.dispatch.wechat;
  assert.match(text, /^【有單・拼車】/);
  assert.match(text, /拼車：2組｜3人｜1件行李｜7座/);
  assert.doesNotMatch(text, /乘客|\+852/);

  const claimPage = await ctx.orders.getByCode(dispatched.code, taker);
  assert.equal(claimPage.carpool?.partyCount, 2);
  assert.equal('passengerName' in claimPage.carpool!.parties[0], false, 'no passenger before claiming');
  assert.equal((await ctx.carpools.passengerSeat(a.code)).arranging, true);

  await ctx.orders.claim(dispatched.code, taker);
  const taken = await ctx.orders.getForParticipant(taker, orderId);
  assert.ok(taken.carpool?.parties[0].passengerContact);
  assert.equal('price' in taken.carpool!.parties[0], false, 'the taker never sees what passengers pay');
  const passenger = await ctx.carpools.passengerSeat(a.code);
  assert.equal(passenger.driver?.name, '李師傅');
  assert.equal(passenger.organizer?.name, '陳師傅');
  assert.deepEqual(passenger.payment?.amount, { amount: 400, currency: 'HKD' });

  await ctx.carpools.passengerCancel(b.code);
  const changed = await ctx.orders.getForParticipant(taker, orderId);
  assert.equal(changed.passengers, 2);
  assert.equal(changed.carpool?.partyCount, 1);
  assert.equal(changed.change?.summary, '乘客');
  const told = (await ctx.notifications.list(taker)).items.map((item) => item.kind);
  assert.ok(told.includes('ORDER_CHANGED'));

  await ctx.orders.reopen(owner, orderId);
  assert.equal((await ctx.carpools.passengerSeat(a.code)).arranging, true);
  await ctx.carpools.cancel(owner, made.id);
  const off = await ctx.carpools.get(owner, made.id);
  assert.equal(off.status, 'CANCELLED');
  assert.equal(off.order?.status, 'CANCELLED');
  assert.equal((await ctx.carpools.passengerSeat(a.code)).driver, null);
});

test('the driver hears when asking for seats closed, once for each closing time', async () => {
  const owner = await driver();
  const now = new Date();
  const made = await ctx.carpools.create(owner, carpool({ pickupAt: iso(inHours(5, now)), closesAt: iso(inHours(1, now)) }), now);
  const later = inHours(1.5, now);
  await ctx.notifications.list(owner, later);
  await ctx.notifications.list(owner, later);
  const closed = (await ctx.notifications.list(owner, later)).items.filter((item) => item.kind === 'CARPOOL_CLOSED');
  assert.equal(closed.length, 1);
  assert.equal(closed[0].carpoolId, made.id);
  const view = await ctx.carpools.get(owner, made.id, later);
  assert.equal(view.status, 'CLOSED');
  await ctx.carpools.update(owner, made.id, { closesAt: iso(inHours(3, now)) }, later);
  assert.equal((await ctx.carpools.get(owner, made.id, later)).status, 'OPEN', 'a later closing time opens it again');
});
