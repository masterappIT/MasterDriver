import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPickup, monthPeriod } from '../common/hong-kong-time';
import {
  claimedShareText,
  dispatchShareText,
  formatPrice,
  passengerShareText,
  plateRequirement,
  roundTripShareText,
  transferPlacesOf,
  type ShareOrder,
} from './share-text';

const order: ShareOrder = {
  // 14:30 Hong Kong time on Thursday 15 October 2026
  pickupAt: new Date('2026-10-15T06:30:00Z'),
  origin: '深圳灣口岸',
  destination: '香港國際機場',
  waypoints: ['海港城'],
  passengers: 4,
  luggage: 3,
  vehicleType: '7座',
  driverPriceMinor: 85000,
  driverCurrency: 'HKD',
  passengerPriceMinor: 100000,
  passengerCurrency: 'HKD',
  showPassengerPrice: false,
  notes: '需要兒童座椅',
};

test('pickup time is shown in Hong Kong time with the weekday', () => {
  assert.equal(formatPickup(order.pickupAt), '10/15（四）14:30');
  assert.equal(formatPickup(new Date('2026-10-15T16:05:00Z')), '10/16（五）00:05');
});

test('monthly quota period follows the Hong Kong calendar', () => {
  assert.equal(monthPeriod(new Date('2026-10-31T16:30:00Z')), '2026-11');
});

test('prices show the currency the dispatcher chose', () => {
  assert.equal(formatPrice(85000, 'HKD'), 'HK$850');
  assert.equal(formatPrice(80050, 'CNY'), 'RMB¥800.5');
  assert.equal(formatPrice(120000, 'MOP'), 'MOP$1,200');
});

test('dispatch text carries the whole order and the claim link', () => {
  const text = dispatchShareText(order, 'https://x.test/o/abc');
  assert.equal(
    text.wechat,
    [
      '【有單】10/15（四）14:30',
      '深圳灣口岸 → 香港國際機場',
      '途經：海港城',
      '4人｜3件行李｜7座',
      'HK$850',
      '備註：需要兒童座椅',
      '搶單：https://x.test/o/abc',
    ].join('\n'),
  );
  assert.ok(text.whatsapp.startsWith('*【有單】10/15（四）14:30*\n'));
});

test('dispatch text skips empty optional parts', () => {
  const text = dispatchShareText(
    { ...order, waypoints: [], vehicleType: null, driverPriceMinor: null, notes: null },
    'https://x.test/o/abc',
  );
  assert.equal(text.wechat, '【有單】10/15（四）14:30\n深圳灣口岸 → 香港國際機場\n4人｜3件行李\n搶單：https://x.test/o/abc');
});

test('dispatch text says so when there is no luggage', () => {
  const text = dispatchShareText({ ...order, luggage: 0, vehicleType: null }, 'https://x.test/o/abc');
  assert.ok(text.wechat.includes('\n4人｜0件行李\n'));
});

test('claimed text names the driver and every plate they gave', () => {
  const text = claimedShareText(order, { name: '李師傅', hkPlate: 'AB1234', macauPlate: null, mainlandPlate: '粤Z1234港' });
  assert.equal(text, '【已派出】10/15（四）14:30 深圳灣口岸 → 香港國際機場\n司機：李師傅\n車牌：AB1234 / 粤Z1234港');
});

test('group text carries the driver price, never the passenger price', () => {
  const text = dispatchShareText({ ...order, showPassengerPrice: true }, 'https://x.test/o/abc').wechat;
  assert.ok(text.includes('HK$850'));
  assert.ok(!text.includes('HK$1,000'));
});

test('passenger message never carries the driver price, and the passenger price only when shown', () => {
  const hidden = passengerShareText(order, 'https://x.test/c/xyz');
  assert.ok(hidden.includes('https://x.test/c/xyz'));
  assert.ok(!hidden.includes('HK$'));
  const shown = passengerShareText({ ...order, showPassengerPrice: true }, 'https://x.test/c/xyz');
  assert.ok(shown.includes('費用 HK$1,000'));
  assert.ok(!shown.includes('HK$850'));
});

test('a leg says where it sits in the trip, where the cars meet and which plate it needs', () => {
  const leg = { ...order, legIndex: 2, legCount: 2, requiredPlates: ['MACAU' as const] };
  const text = dispatchShareText(leg, 'https://x.test/o/abc').wechat;
  assert.ok(text.includes('接駁：第 2／2 段'));
  assert.ok(text.includes('接駁位置：深圳灣口岸\n'), 'the last leg starts at the transfer place');
  assert.ok(text.includes('需澳門車'));
  const plain = dispatchShareText(order, 'https://x.test/o/abc').wechat;
  assert.ok(!plain.includes('接駁') && !plain.includes('車牌') && !plain.includes('澳門車'));
});

test('a first leg ends at the transfer place, also before the next leg is added', () => {
  const alone = dispatchShareText({ ...order, legIndex: 1, legCount: 1 }, 'https://x.test/o/abc').wechat;
  assert.ok(alone.includes('接駁：第 1 段\n'));
  assert.ok(alone.includes('接駁位置：香港國際機場'));
  assert.deepEqual(transferPlacesOf({ ...order, legIndex: 2, legCount: 3 }), ['深圳灣口岸', '香港國際機場']);
  assert.equal(plateRequirement(['HK', 'MACAU']), '需香港＋澳門車牌');
  assert.equal(plateRequirement([]), null);
});

test('the passenger message for a 接駁 order says the car changes on the way, not where, with its one price', () => {
  const first = { ...order, destination: '港珠澳大橋香港口岸', showPassengerPrice: true, passengerPriceMinor: 100000 };
  const second = { ...order, origin: '港珠澳大橋香港口岸', destination: '澳門威尼斯人', showPassengerPrice: false, passengerPriceMinor: null };
  const text = passengerShareText(first, 'https://x.test/c/xyz', [first, second]);
  assert.ok(text.includes('深圳灣口岸 → 澳門威尼斯人（接駁，中途換車）'));
  assert.ok(text.includes('費用 HK$1,000'));
  assert.ok(!text.includes('港珠澳大橋香港口岸'));
});
test('即時單 reads 現在出發 in the group instead of a time', () => {
  const now = { ...order, immediate: true };
  const text = dispatchShareText(now, 'https://example.test/o/abc');
  assert.equal(text.wechat.split('\n')[0], '【即時】現在出發');
  assert.equal(text.whatsapp.split('\n')[0], '*【即時】現在出發*');
  assert.ok(text.wechat.includes('深圳灣口岸 → 香港國際機場'));
  assert.ok(!text.wechat.includes('14:30'));
});

test('a carpool order lists its pickups and parties for drivers, never a passenger', async () => {
  const { carpoolShareText } = await import('./share-text');
  const text = carpoolShareText({ ...order, waypoints: [], passengers: 3, luggage: 2 }, { partyCount: 2, stops: ['深圳灣口岸', '南山海岸城'] }, 'https://x.test/o/abc');
  assert.equal(
    text.wechat,
    ['【有單・拼車】10/15（四）14:30', '深圳灣口岸 → 香港國際機場', '上車點：深圳灣口岸、南山海岸城', '拼車：2組｜3人｜2件行李｜7座', 'HK$850', '備註：需要兒童座椅', '搶單：https://x.test/o/abc'].join('\n'),
  );
  assert.ok(text.whatsapp.startsWith('*【有單・拼車】10/15（四）14:30*\n'));
});

test('a 往返 is one text with both legs, their flights, prices and who takes them, and one link', () => {
  const there = { ...order, waypoints: [], legIndex: 1, legCount: 2, journeyKind: 'ROUND_TRIP' as const, sameDriver: true, selfDriven: false, flightNo: 'CX101' };
  const back = {
    ...there,
    legIndex: 2,
    origin: '香港國際機場',
    destination: '深圳灣口岸',
    pickupAt: new Date('2026-10-15T12:00:00Z'),
    driverPriceMinor: 60000,
    flightNo: 'CX102',
  };
  const text = roundTripShareText([there, back], 'https://x.test/o/abc').wechat;
  assert.equal(
    text,
    [
      '【有單・往返】10/15（四）14:30',
      '深圳灣口岸 ⇄ 香港國際機場',
      '去程：10/15（四）14:30 深圳灣口岸 → 香港國際機場｜航班 CX101｜HK$850',
      '回程：10/15（四）20:00 香港國際機場 → 深圳灣口岸｜航班 CX102｜HK$600',
      '同一位司機來回，來回共 HK$1,450',
      '4人｜3件行李｜7座',
      '備註：需要兒童座椅',
      '搶單（來回）：https://x.test/o/abc',
    ].join('\n'),
  );
  const apart = roundTripShareText([{ ...there, sameDriver: false }, { ...back, sameDriver: false, selfDriven: true }], 'https://x.test/o/abc').wechat;
  assert.ok(apart.includes('可分開接，選一程搶'));
  assert.ok(apart.includes('回程：10/15（四）20:00 香港國際機場 → 深圳灣口岸｜航班 CX102｜出單者自己開'));
  assert.ok(!apart.includes('來回共'), 'no total when the legs are claimed apart');
  // A leg the dispatcher drives, or prices in two currencies: no total.
  assert.ok(!roundTripShareText([there, { ...back, selfDriven: true }], 'https://x.test/o/abc').wechat.includes('來回共'));
  assert.ok(!roundTripShareText([there, { ...back, driverCurrency: 'CNY' as const }], 'https://x.test/o/abc').wechat.includes('來回共'));
  assert.ok(apart.endsWith('搶單（選一程）：https://x.test/o/abc'));
  assert.ok(!apart.includes('接駁'));
  // Back from somewhere else: no A ⇄ B line, each leg says its own places.
  const elsewhere = roundTripShareText([there, { ...back, origin: '福田口岸' }], 'https://x.test/o/abc').wechat;
  assert.ok(!elsewhere.includes('⇄'));
  assert.ok(elsewhere.includes('回程：10/15（四）20:00 福田口岸 → 深圳灣口岸'));

  const driver = { name: '李師傅', hkPlate: 'AB1234', macauPlate: null, mainlandPlate: null };
  // 同一位司機來回: one job, said with when the way back leaves, from either leg.
  assert.ok(claimedShareText(there, driver, [there, back]).startsWith('【已派出】10/15（四）14:30 深圳灣口岸 → 香港國際機場（來回，回程 10/15（四）20:00）'));
  assert.ok(claimedShareText(back, driver, [there, back]).startsWith('【已派出】10/15（四）14:30 深圳灣口岸 → 香港國際機場（來回，回程 10/15（四）20:00）'));
  assert.ok(claimedShareText({ ...back, sameDriver: false }, driver).includes('（回程）'));

  const passenger = passengerShareText(there, 'https://x.test/c/xyz', [
    { ...there, showPassengerPrice: true },
    { ...back, passengerPriceMinor: null },
  ]);
  assert.ok(passenger.includes('往返行程（去程 10/15（四）14:30 深圳灣口岸 → 香港國際機場，回程 10/15（四）20:00 香港國際機場 → 深圳灣口岸）'));
  assert.ok(passenger.includes('費用 HK$1,000'));
  assert.ok(!passenger.includes('HK$850') && !passenger.includes('HK$600'));
});

/** 包車: 8 hours from 09:00 on Sunday 25 October, back where it started, by the day's stops. */
const charter: ShareOrder = {
  ...order,
  pickupAt: new Date('2026-10-25T01:00:00Z'),
  destination: '深圳灣口岸',
  waypoints: ['羅湖', '東門', '華強北'],
  passengers: 3,
  luggage: 0,
  driverPriceMinor: 200000,
  passengerPriceMinor: 240000,
  notes: null,
  charterMinutes: 480,
  driverHourlyMinor: 25000,
  overtimeDriverHourlyMinor: null,
  overtimeUnitMinutes: 30,
  overtimeGraceMinutes: 15,
  charterExtras: ['TOLLS', 'PARKING'],
};

test('包車 group text: from when and how long, the stops, an hour and the total, and the dispatcher\'s rules', () => {
  const text = dispatchShareText(charter, 'https://x.test/o/abc');
  assert.equal(
    text.wechat,
    [
      '【有單・包車】10/25（日）09:00 起 8 小時',
      '深圳灣口岸 上車，原地結束',
      '行程：羅湖 → 東門 → 華強北',
      '3人｜0件行李｜7座',
      '每小時 HK$250，8 小時共 HK$2,000',
      '超時每小時 HK$250，每 30 分鐘計，15 分鐘內不計',
      '路橋費、停車費另計',
      '搶單：https://x.test/o/abc',
    ].join('\n'),
  );
  assert.ok(text.whatsapp.startsWith('*【有單・包車】10/25（日）09:00 起 8 小時*\n'));
  assert.doesNotMatch(text.wechat, /2,400|91234567/, 'never the passenger price or contact');
});

test('包車 without a price says how 超時 is counted; one ending elsewhere says where; 即時 starts now', () => {
  const unpriced = dispatchShareText(
    { ...charter, destination: '香港國際機場', driverHourlyMinor: null, driverPriceMinor: null, overtimeUnitMinutes: 60, overtimeGraceMinutes: 0, charterExtras: [] },
    'https://x.test/o/abc',
  ).wechat;
  assert.match(unpriced, /\n深圳灣口岸 上車 → 香港國際機場 結束\n/);
  assert.match(unpriced, /\n超時按每小時計\n/);
  assert.doesNotMatch(unpriced, /每小時 HK|另計/);
  const overtime = dispatchShareText({ ...charter, overtimeDriverHourlyMinor: 30000 }, 'https://x.test/o/abc').wechat;
  assert.match(overtime, /\n超時每小時 HK\$300，每 30 分鐘計，15 分鐘內不計\n/);
  assert.match(dispatchShareText({ ...charter, immediate: true, charterMinutes: 390 }, 'https://x.test/o/abc').wechat, /^【即時・包車】現在出發，6\.5 小時\n/);
});

test('包車 to the passenger and back to the group once a driver has it', () => {
  assert.equal(
    passengerShareText({ ...charter, showPassengerPrice: true }, 'https://x.test/c/xyz'),
    '您好，您的包車 10/25（日）09:00 起 8 小時（深圳灣口岸上車）已安排，費用 HK$2,400，請按連結查看並確認：https://x.test/c/xyz',
  );
  assert.equal(
    claimedShareText(charter, { name: '陳師傅', hkPlate: 'AB1234', macauPlate: null, mainlandPlate: null }),
    '【已派出】10/25（日）09:00 起包車 8 小時（深圳灣口岸上車）\n司機：陳師傅\n車牌：AB1234',
  );
});
