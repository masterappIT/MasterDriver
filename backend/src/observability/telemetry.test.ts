import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categoryOf, clientOf, hongKongDay, observed, queryOperation, sourceOf, telemetry, type TelemetryEvent } from './telemetry';

test('requests are sorted into the parts of MasterDriver by their route', () => {
  assert.equal(sourceOf('/api/admin/users/:id'), 'admin');
  assert.equal(sourceOf('/api/c/:confirmCode'), 'passenger');
  assert.equal(sourceOf('/api/public/profiles/:code/bookings'), 'passenger');
  assert.equal(sourceOf('/api/public/bookings/:code/accept'), 'passenger');
  assert.equal(sourceOf('/api/public/settings'), 'backend');
  assert.equal(sourceOf('/api/health/live'), 'backend');
  assert.equal(sourceOf('/api/o/:code/claim'), 'driver');
  assert.equal(sourceOf('/api/orders'), 'driver');
  assert.equal(categoryOf('/api/health/ready'), 'health');
  assert.equal(observed('/api/notifications/stream'), false);
  assert.equal(observed('/api/admin/observability/stream'), false);
  assert.equal(observed('/api/orders'), true);
});

test('where a page was opened, from its browser', () => {
  assert.equal(clientOf('Mozilla/5.0 (iPhone) AppleWebKit Mobile/15E148 MicroMessenger/8.0.50'), 'WECHAT');
  assert.equal(clientOf('Mozilla/5.0 (Linux; Android 14) WhatsApp/2.24'), 'WHATSAPP');
  assert.equal(clientOf('Mozilla/5.0 (Macintosh) Safari/605.1.15'), 'BROWSER');
  assert.equal(clientOf('GoogleHC/1.0'), 'NONE');
  assert.equal(clientOf(undefined), 'NONE');
});

test('a query is named by what it does and to which table, without the SQL', () => {
  assert.equal(queryOperation('SELECT "public"."Order"."id" FROM "public"."Order" WHERE "id" = $1'), 'SELECT Order');
  assert.equal(queryOperation('UPDATE "public"."Notification" SET "readAt" = $1'), 'UPDATE Notification');
  assert.equal(queryOperation('SELECT 1'), 'SELECT');
  assert.equal(queryOperation('BEGIN'), null);
});

test('the day is Hong Kong time', () => {
  assert.equal(hongKongDay(new Date('2026-10-14T15:59:00Z')).toISOString(), '2026-10-14T00:00:00.000Z');
  assert.equal(hongKongDay(new Date('2026-10-14T16:00:00Z')).toISOString(), '2026-10-15T00:00:00.000Z');
});

test('events are only built while someone watches', () => {
  telemetry.domain('order.create');
  const seen: TelemetryEvent[] = [];
  const stop = telemetry.listen((event) => seen.push(event));
  telemetry.domain('order.claim', 'lost');
  stop();
  telemetry.domain('order.cancel');
  assert.deepEqual(seen.map((event) => [event.source, event.operation, event.status]), [['service', 'order.claim', 'lost']]);
  assert.equal(telemetry.watched, false);
});
