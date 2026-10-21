import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dealShareText, formatDealTime } from './deal-share-text';

const deal = {
  pickupAt: new Date('2026-10-25T08:00:00Z'),
  pickupUntil: null,
  origin: '深圳灣口岸',
  destination: '香港國際機場',
  priceMinor: 35000,
  currency: 'CNY' as const,
  originalPriceMinor: 50000,
  maxPassengers: 6,
  maxLuggage: 6,
  notes: null,
};

test('the 特價車 text says when, where, the car, the price and the link', () => {
  const text = dealShareText(deal, { name: '陳師傅', vehicleType: '埃爾法', seats: 7 }, 'https://x.test/d/abc');
  assert.equal(
    text.wechat,
    '【特價車】10/25（日）16:00 深圳灣口岸 → 香港國際機場\n埃爾法・7座｜整車 RMB¥350（原價 RMB¥500）\n最多 6 人、6 件行李\n陳師傅的特價車，點開預約，不用註冊：https://x.test/d/abc',
  );
  assert.ok(text.whatsapp.startsWith('*【特價車】10/25（日）16:00 深圳灣口岸 → 香港國際機場*\n'));
});

test('the 特價車 text leaves out what the driver did not fill in, and says a 時段 can be picked from', () => {
  const text = dealShareText(
    { ...deal, pickupUntil: new Date('2026-10-25T12:00:00Z'), originalPriceMinor: null, maxPassengers: null, maxLuggage: null, notes: '可放嬰兒車' },
    { name: null, vehicleType: null, seats: null },
    'https://x.test/d/abc',
  );
  assert.equal(
    text.wechat,
    '【特價車】10/25（日）16:00–20:00 深圳灣口岸 → 香港國際機場\n整車 RMB¥350\n時段內任選出發時間\n備註：可放嬰兒車\n點開預約，不用註冊：https://x.test/d/abc',
  );
});

test('a 時段 into the next day carries the end date', () => {
  assert.equal(
    formatDealTime({ pickupAt: new Date('2026-10-25T14:00:00Z'), pickupUntil: new Date('2026-10-25T18:00:00Z') }),
    '10/25（日）22:00 – 10/26（一）02:00',
  );
});
