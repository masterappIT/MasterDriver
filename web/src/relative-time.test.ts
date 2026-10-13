import assert from 'node:assert/strict';
import { test } from 'node:test';
import { timeUntil } from './relative-time';

const now = new Date('2026-10-14T06:00:00Z');
const later = (minutes: number) => new Date(now.getTime() + minutes * 60_000).toISOString();

test('says how long until the pickup, rounded down', () => {
  assert.equal(timeUntil(later(0.5), now), '即將出發');
  assert.equal(timeUntil(later(35), now), '35 分鐘後');
  assert.equal(timeUntil(later(59.9), now), '59 分鐘後');
  assert.equal(timeUntil(later(120), now), '2 小時後');
  assert.equal(timeUntil(later(170), now), '2 小時 50 分鐘後');
  assert.equal(timeUntil(later(5 * 60 + 59), now), '5 小時後');
  assert.equal(timeUntil(later(47 * 60), now), '47 小時後');
  assert.equal(timeUntil(later(49 * 60), now), '2 天後');
});

test('says nothing once the pickup time has passed or is unreadable', () => {
  assert.equal(timeUntil(later(-1), now), null);
  assert.equal(timeUntil('not a date', now), null);
});
