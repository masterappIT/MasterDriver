import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { after, before, beforeEach, test } from 'node:test';
import type { Request, Response } from 'express';
import { createDriver, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';
import { LocalMediaStorage } from '../storage/media-storage';
import { ObservabilityService } from './observability.service';

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

const WECHAT = 'Mozilla/5.0 (iPhone) AppleWebKit Mobile/15E148 MicroMessenger/8.0.50';

/** One request through the middleware, as Express would run it, finished with `status`. */
async function request(service: ObservabilityService, route: string, status: number, options: { userId?: string; userAgent?: string } = {}) {
  const req = { route: { path: route }, ip: '10.0.0.8', method: 'GET', headers: { 'user-agent': options.userAgent ?? WECHAT }, user: options.userId ? { id: options.userId } : undefined };
  const res = Object.assign(new EventEmitter(), { statusCode: status });
  service.middleware(req as unknown as Request, res as unknown as Response, () => undefined);
  res.emit('finish');
  await new Promise((done) => setImmediate(done));
}

test('requests are counted by place, part and browser, added up across flushes; health checks stay apart', async () => {
  const service = ctx.observability;
  const driver = await createDriver(ctx);
  await request(service, '/api/orders', 200, { userId: driver });
  await request(service, '/api/orders/:id', 500, { userId: driver });
  await request(service, '/api/c/:confirmCode', 404, { userAgent: 'Mozilla/5.0 (Linux; Android 14) WhatsApp/2.24' });
  await request(service, '/api/health/live', 200, { userAgent: 'GoogleHC/1.0' });
  await request(service, '/api/notifications/stream', 200, { userId: driver });
  await service.flush();
  await request(service, '/api/orders', 200, { userId: driver });
  await service.flush();

  const rows = await ctx.prisma.observabilityRequestStat.findMany({ orderBy: [{ source: 'asc' }, { category: 'asc' }] });
  assert.deepEqual(
    rows.map((row) => [row.region, row.area, row.source, row.client, row.category, row.count, row.errors, row.clientErrors]),
    [
      ['本機／內網', 'INTERNAL', 'backend', 'NONE', 'health', 1, 0, 0],
      ['本機／內網', 'INTERNAL', 'driver', 'WECHAT', 'application', 3, 1, 0],
      ['本機／內網', 'INTERNAL', 'passenger', 'WHATSAPP', 'application', 1, 0, 1],
    ],
    'the 通知 stream is a connection, not a request',
  );

  const snapshot = await service.snapshot();
  assert.deepEqual(snapshot.areas.map((row) => [row.area, row.count, row.errors, row.clientErrors]), [['INTERNAL', 4, 1, 1]], 'health checks are left out of speed and errors');
  assert.equal(snapshot.presence.activity['driver:WECHAT'].count, 1);
  assert.equal(snapshot.presence.activity['passenger:WHATSAPP'].count, 1);
  assert.equal(snapshot.write.status, 'ok');
});

test('presence and open 通知 streams add up across instances, one driver counted once', async () => {
  const storage = new LocalMediaStorage('/tmp/md-observability-test');
  const first = new ObservabilityService(ctx.prisma, storage);
  const second = new ObservabilityService(ctx.prisma, storage);
  const driver = await createDriver(ctx, '陳師傅');
  const other = await createDriver(ctx, '李師傅');
  await request(first, '/api/orders', 200, { userId: driver });
  await request(second, '/api/orders', 200, { userId: driver });
  await request(second, '/api/orders', 200, { userId: other });
  const disconnect = second.connect(other, { headers: { 'user-agent': WECHAT }, ip: '10.0.0.9' } as unknown as Request);
  await second.flush();
  await first.flush();

  const snapshot = await first.snapshot();
  assert.equal(snapshot.instances, 2);
  assert.equal(snapshot.presence.activity['driver:WECHAT'].count, 2, 'the same driver on two instances counts once');
  assert.deepEqual(snapshot.streams, { open: 1, capacity: 160, perInstance: 80 });

  const { users } = await first.identities();
  assert.deepEqual(users.map((user) => [user.name, user.connected]).sort(), [['李師傅', true], ['陳師傅', false]]);

  disconnect();
  await second.flush();
  assert.equal((await first.snapshot()).streams.open, 0);
  await second.onModuleDestroy();
  assert.equal((await first.snapshot()).instances, 1, 'a stopped instance leaves');
});

test("the day's business numbers come from the records themselves", async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const other = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(order.code, driver);
  await ctx.orders.claim(order.code, other);
  const view = await ctx.orders.getForParticipant(dispatcher, order.id);
  await ctx.orders.confirmByPassenger(view.links.passengerConfirm.split('/c/')[1]);
  await ctx.orders.complete(driver, order.id);
  const second = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.cancel(dispatcher, second.id);
  await ctx.prisma.smsMessage.create({ data: { route: 'INTERNATIONAL', countryCode: '+852', phone: '91234567', purpose: 'otp', status: 'sent' } });
  await ctx.prisma.smsMessage.create({ data: { route: 'INTERNATIONAL', countryCode: '+852', phone: '91234567', purpose: 'otp', status: 'failed' } });

  const { business, sms, services } = await ctx.observability.snapshot();
  assert.deepEqual(business, { orders: 2, claimsWon: 1, claimsLost: 1, confirmed: 1, completed: 1, cancelled: 1, bookings: 0, users: 3 });
  assert.deepEqual(sms.today.map((row) => [row.provider, row.status, row.count]).sort(), [['SMS253', 'failed', 1], ['SMS253', 'sent', 1]]);
  assert.ok(sms.lastSent[0].at);
  assert.equal(services.database.ok, true);
});
