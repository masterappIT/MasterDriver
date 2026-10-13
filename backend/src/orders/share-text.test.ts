import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatPickup, monthPeriod } from '../common/hong-kong-time';
import { claimedShareText, dispatchShareText, formatPrice, passengerShareText, type ShareOrder } from './share-text';

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

test('a following leg says where it sits in the trip and how the passenger gets there', () => {
  const leg = { ...order, legIndex: 2, legCount: 2, handoffNote: '乘客自行過關（穿梭巴士）' };
  const text = dispatchShareText(leg, 'https://x.test/o/abc').wechat;
  assert.ok(text.includes('接駁：第 2／2 段'));
  assert.ok(text.includes('交接：乘客自行過關（穿梭巴士）'));
  assert.ok(!dispatchShareText(order, 'https://x.test/o/abc').wechat.includes('接駁'));
});

test('the passenger message for a trip covers every leg and adds up prices shown in one currency', () => {
  const hk = { ...order, destination: '港珠澳大橋香港口岸', showPassengerPrice: true, passengerPriceMinor: 60000 };
  const macau = { ...order, origin: '港珠澳大橋澳門口岸', destination: '澳門威尼斯人', showPassengerPrice: true, passengerPriceMinor: 40000 };
  const text = passengerShareText(hk, 'https://x.test/c/xyz', [hk, macau]);
  assert.ok(text.includes('深圳灣口岸 → 澳門威尼斯人（2 段接駁）'));
  assert.ok(text.includes('費用 HK$1,000'));
  const mixed = passengerShareText(hk, 'https://x.test/c/xyz', [hk, { ...macau, passengerCurrency: 'MOP' }]);
  assert.ok(!mixed.includes('費用'));
});
