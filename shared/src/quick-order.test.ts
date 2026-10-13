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
