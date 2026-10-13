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

test('the passenger sees no driver before the order is claimed', () => {
  const view = toPassengerView({ ...order, status: 'OPEN', claimedById: null, claimedBy: null });
  assert.equal(view.driver, null);
});
