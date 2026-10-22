import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseQuickOrder } from './quick-order';

// Tuesday 13 October 2026, 19:03 in Hong Kong.
const now = new Date('2026-10-13T11:03:00Z');

test('「现在深圳湾送九龙8座」 — 现在 means a few minutes from now', () => {
  const order = parseQuickOrder('现在深圳湾送九龙8座', now);
  assert.equal(order.pickupAt, '2026-10-13T19:05:00+08:00');
  assert.equal(order.origin, '深圳湾');
  assert.equal(order.destination, '九龙');
  assert.equal(order.vehicleType, '8座');
  assert.deepEqual(order.missing, []);
});

test('words for "now" make it a 即時單; a time does not', () => {
  for (const line of ['现在深圳湾送九龙8座', '馬上皇崗口岸去機場', '而家福田口岸到香港 2人']) {
    assert.equal(parseQuickOrder(line, now).immediate, true, line);
  }
  assert.equal(parseQuickOrder('明天15:40澳门送香港', now).immediate, undefined);
  assert.equal(parseQuickOrder('馬上皇崗口岸去機場', now).origin, '皇崗口岸');
});

test('「明天15:40澳门送香港，直车」 — a service word after a comma is a note', () => {
  const order = parseQuickOrder('明天15:40澳门送香港，直车', now);
  assert.equal(order.pickupAt, '2026-10-14T15:40:00+08:00');
  assert.equal(order.origin, '澳门');
  assert.equal(order.destination, '香港');
  assert.equal(order.notes, '直车');
});

test('「明天8:30九龙送珠海接驳」 — a service word is a note, not part of the place', () => {
  const order = parseQuickOrder('明天8:30九龙送珠海接驳', now);
  assert.equal(order.pickupAt, '2026-10-14T08:30:00+08:00');
  assert.equal(order.origin, '九龙');
  assert.equal(order.destination, '珠海');
  assert.equal(order.notes, '接驳');
});

test('「6：20香机到南山」 — full-width colon, and a time already past means tomorrow', () => {
  const order = parseQuickOrder('6：20香机到南山', now);
  assert.equal(order.pickupAt, '2026-10-14T06:20:00+08:00');
  assert.equal(order.origin, '香机');
  assert.equal(order.destination, '南山');
});

test('a fuller Traditional Chinese order with people, luggage, car and price', () => {
  const order = parseQuickOrder('10/15 14:30 深圳灣口岸到香港機場 4人3件 埃爾法7座 HK$850 需要兒童座椅', now);
  assert.equal(order.pickupAt, '2026-10-15T14:30:00+08:00');
  assert.equal(order.origin, '深圳灣口岸');
  assert.equal(order.destination, '香港機場');
  assert.equal(order.passengers, 4);
  assert.equal(order.luggage, 3);
  assert.equal(order.vehicleType, '埃爾法 7座');
  assert.deepEqual(order.price, { amount: 850, currency: 'HKD' });
  assert.equal(order.notes, '需要兒童座椅');
});

test('afternoon words, half past, and renminbi prices', () => {
  const order = parseQuickOrder('今晚8点半福田口岸去广州南站 2大1小 600元', now);
  assert.equal(order.pickupAt, '2026-10-13T20:30:00+08:00');
  assert.equal(order.origin, '福田口岸');
  assert.equal(order.destination, '广州南站');
  assert.equal(order.passengers, 3);
  assert.deepEqual(order.price, { amount: 600, currency: 'CNY' });
});

test('reports what it could not read', () => {
  assert.deepEqual(parseQuickOrder('有冇人接單', now).missing, ['pickupAt', 'origin', 'destination']);
  assert.deepEqual(parseQuickOrder('明天機場送深圳灣', now).missing, ['pickupAt']);
});

test('「明天10:00深圳湾往返机场」 — 往返 between two places reads as the way there, and marks the order 往返', () => {
  const order = parseQuickOrder('明天10:00深圳湾往返机场', now);
  assert.equal(order.pickupAt, '2026-10-14T10:00:00+08:00');
  assert.equal(order.origin, '深圳湾');
  assert.equal(order.destination, '机场');
  assert.equal(order.roundTrip, true);
  assert.equal(order.notes, '往返');
});

test('「明天9點香港到深圳來回」 — 來回 after the route marks the order 往返; a one-way line does not', () => {
  const order = parseQuickOrder('明天9點香港到深圳來回', now);
  assert.equal(order.origin, '香港');
  assert.equal(order.destination, '深圳');
  assert.equal(order.roundTrip, true);
  assert.equal(parseQuickOrder('明天15:40澳门送香港，直车', now).roundTrip, undefined);
});

test('「明天9點深圳灣包車8小時 每小時250蚊 7座」 — 包車 with its hours and price an hour', () => {
  const order = parseQuickOrder('明天9點深圳灣包車8小時 每小時250蚊 7座', now);
  assert.equal(order.pickupAt, '2026-10-14T09:00:00+08:00');
  assert.deepEqual(order.charter, { minutes: 480, hourly: { amount: 250, currency: 'HKD' } });
  assert.equal(order.price, undefined);
  assert.equal(order.passengers, undefined, '8小時 is not 8 children');
  assert.equal(order.vehicleType, '7座');
});

test('包車 hours written other ways, and a price an hour after the amount', () => {
  assert.deepEqual(parseQuickOrder('后天10:00 包8个钟 RMB300/小时', now).charter, { minutes: 480, hourly: { amount: 300, currency: 'CNY' } });
  assert.deepEqual(parseQuickOrder('明早8點 包車 6.5 小時 羅湖上車', now).charter, { minutes: 390 });
  assert.equal(parseQuickOrder('明早8點 包8個鐘 羅湖上車', now).pickupAt, '2026-10-14T08:00:00+08:00');
});

test('「包一日」 is 包車 without guessing the hours; a price not said to be an hour\'s stays a price', () => {
  const order = parseQuickOrder('明天包一日 福田出發 HK$2000', now);
  assert.deepEqual(order.charter, {});
  assert.deepEqual(order.price, { amount: 2000, currency: 'HKD' });
});

test('a line without 包車 has no charter, and 包 in a place name stays', () => {
  assert.equal(parseQuickOrder('明天15:40澳门送香港，直车', now).charter, undefined);
  assert.equal(parseQuickOrder('明天10點包頭送北京', now).destination, '北京');
});
