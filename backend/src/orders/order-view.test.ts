import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toOrderView, toPassengerView, viewerOf, type OrderWithPeople } from './order-view';

const order = {
  id: 'order-1',
  code: 'ABCDEFGHIJ',
  confirmCode: 'CONFIRMCODE1',
  dispatcherId: 'dispatcher',
  scope: 'PUBLIC',
  status: 'ASSIGNED',
  pickupAt: new Date('2026-10-15T06:30:00Z'),
  origin: '深圳灣口岸',
  destination: '香港國際機場',
  waypoints: [],
  passengers: 4,
  luggage: 3,
  vehicleType: null,
  driverPriceMinor: 85000,
  driverCurrency: 'HKD',
  passengerPriceMinor: 100000,
  passengerCurrency: 'HKD',
  showPassengerPrice: false,
  notes: null,
  passengerName: '陳先生',
  passengerContact: '+852 9123 4567',
  contactRevealMinutes: null,
  claimedById: 'driver',
  claimedAt: new Date('2026-10-14T01:00:00Z'),
  passengerConfirmedAt: null,
  completedAt: null,
  cancelledAt: null,
  createdAt: new Date('2026-10-14T00:00:00Z'),
  updatedAt: new Date('2026-10-14T01:00:00Z'),
  dispatcher: { profile: { name: '陳師傅' } },
  claimedBy: {
    countryCode: '+852',
    phone: '61234567',
    profile: {
      userId: 'driver',
      name: '李師傅',
      hkPlate: 'AB1234',
      macauPlate: null,
      mainlandPlate: '粤Z1234港',
      vehicleType: '商務車',
      seats: 7,
      color: '白色',
      updatedAt: new Date(),
    },
  },
} as OrderWithPeople;

test('identifies who is looking at the order', () => {
  assert.equal(viewerOf(order, 'dispatcher'), 'dispatcher');
  assert.equal(viewerOf(order, 'driver'), 'driver');
  assert.equal(viewerOf(order, 'someone-else'), 'other');
  assert.equal(viewerOf(order, undefined), 'other');
});

test('other drivers never see the passenger, the driver, the passenger price or the links', () => {
  const view = toOrderView(order, 'other', 'https://x.test') as Record<string, unknown>;
  for (const hidden of ['id', 'passengerName', 'passengerContact', 'driver', 'links', 'passengerPrice', 'margin']) {
    assert.equal(hidden in view, false, `${hidden} must be hidden`);
  }
  assert.equal(view.status, 'ASSIGNED');
});

test('the winning driver sees the passenger but not the dispatcher links', () => {
  const view = toOrderView(order, 'driver', 'https://x.test') as Record<string, unknown>;
  assert.equal(view.passengerContact, '+852 9123 4567');
  assert.deepEqual(view.driverPrice, { amount: 850, currency: 'HKD' });
  for (const hidden of ['links', 'passengerPrice', 'margin', 'showPassengerPrice']) assert.equal(hidden in view, false);
});

test('the dispatcher sees everything including both links', () => {
  const view = toOrderView(order, 'dispatcher', 'https://x.test');
  assert.deepEqual(view.links, { dispatch: 'https://x.test/o/ABCDEFGHIJ', passengerConfirm: 'https://x.test/c/CONFIRMCODE1' });
  assert.equal(view.driver?.phone, '+852 61234567');
  assert.deepEqual(view.passengerPrice, { amount: 1000, currency: 'HKD' });
  assert.deepEqual(view.margin, { amount: 150, currency: 'HKD' });
});

test('no spread is shown when the two prices are in different currencies', () => {
  const view = toOrderView({ ...order, passengerCurrency: 'CNY' }, 'dispatcher', 'https://x.test');
  assert.equal(view.margin, null);
});

test('the passenger sees the driver and plates but never the driver price', () => {
  const view = toPassengerView(order) as Record<string, unknown>;
  assert.equal(view.price, null);
  assert.equal('driverPrice' in view, false);
  assert.deepEqual((view.driver as { mainlandPlate: string }).mainlandPlate, '粤Z1234港');
});

test('the passenger sees their own price only when the dispatcher shows it', () => {
  assert.deepEqual(toPassengerView({ ...order, showPassengerPrice: true }).price, { amount: 1000, currency: 'HKD' });
});

test('the driver sees the passenger contact only from the reveal time; the dispatcher always', () => {
  const timed = { ...order, contactRevealMinutes: 60 };
  const before = new Date('2026-10-15T05:29:00Z'); // 13:29 Hong Kong, pickup 14:30
  const after = new Date('2026-10-15T05:30:00Z');
  const hidden = toOrderView(timed, 'driver', 'https://x.test', before);
  assert.equal(hidden.passengerContact, null);
  assert.equal(hidden.contactRevealAt, '2026-10-15T05:30:00.000Z');
  assert.equal(toOrderView(timed, 'driver', 'https://x.test', after).passengerContact, '+852 9123 4567');
  assert.equal(toOrderView(timed, 'dispatcher', 'https://x.test', before).passengerContact, '+852 9123 4567');
});

test('once the trip is over the passenger keeps the driver and car but not the driver numbers', () => {
  const during = toPassengerView(order);
  assert.ok(during.driver && during.driver.phones.length > 0);
  const after = toPassengerView({ ...order, status: 'COMPLETED' });
  assert.ok(after.driver);
  assert.equal(after.driver.phone, null);
  assert.deepEqual(after.driver.phones, []);
  assert.equal(after.driver.name, during.driver.name);
  // The person who arranged the trip stays reachable.
  assert.ok(after.dispatcher && after.dispatcher.phones.length > 0);
  assert.equal(after.tripGroup, null);
});

test('a trip its dispatcher drove gives the dispatcher contact once it is over', () => {
  const own = { ...order, claimedById: order.dispatcherId };
  assert.equal(toPassengerView(own).dispatcher, null);
  assert.ok(toPassengerView({ ...own, status: 'COMPLETED' }).dispatcher);
});

test('the passenger sees no driver before the order is claimed', () => {
  const view = toPassengerView({ ...order, status: 'OPEN', claimedById: null, claimedBy: null });
  assert.equal(view.driver, null);
});

test('the dispatcher is told when the driver who took the order was deleted since', () => {
  // 刪除用戶 takes the driver off and keeps when the order was taken.
  const deleted = { ...order, status: 'COMPLETED', completedAt: new Date('2026-10-15T08:00:00Z'), claimedById: null, claimedBy: null } as OrderWithPeople;
  const view = toOrderView(deleted, 'dispatcher', 'https://x.test');
  assert.equal(view.driverDeleted, true);
  assert.equal(view.driver, null);
  assert.equal(view.claimedAt, '2026-10-14T01:00:00.000Z');
  assert.equal(toOrderView(order, 'dispatcher', 'https://x.test').driverDeleted, false);
  // Never taken, or given back (claimedAt cleared): nobody was deleted.
  assert.equal(toOrderView({ ...order, status: 'OPEN', claimedById: null, claimedBy: null, claimedAt: null }, 'dispatcher', 'https://x.test').driverDeleted, false);
  assert.equal('driverDeleted' in toOrderView(deleted, 'other', 'https://x.test'), false);
});

test('a 接駁 leg whose driver was deleted is marked for the dispatcher only', () => {
  const first = { ...order, id: 'leg-1', legIndex: 1, destination: '港珠澳大橋', status: 'COMPLETED', claimedById: null, claimedBy: null };
  const second = { ...order, id: 'leg-2', code: 'KLMNOPQRST', legIndex: 2, origin: '港珠澳大橋', status: 'COMPLETED' };
  const journeyHead = { journeyLegs: [first, second], tripGroup: null };
  const legOrder = { ...second, journeyHead } as unknown as OrderWithPeople;
  const legs = toOrderView(legOrder, 'dispatcher', 'https://x.test', new Date(), 'dispatcher').journey?.legs;
  assert.deepEqual(legs?.map((leg) => leg.driverDeleted), [true, false]);
  const driverLegs = toOrderView(legOrder, 'driver', 'https://x.test', new Date(), 'driver').journey?.legs;
  assert.equal(driverLegs?.some((leg) => 'driverDeleted' in leg), false);
});
