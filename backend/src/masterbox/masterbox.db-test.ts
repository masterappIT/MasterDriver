import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { loadConfig } from '../config';
import { createDriver, setupDatabase, type TestContext } from '../test/database';
import { MasterBoxCustomers } from './masterbox-customers';
import type { MasterBoxEvent } from './masterbox-webhook';

let ctx: TestContext;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
});
after(async () => {
  ctx?.streams.onModuleDestroy();
  await ctx?.prisma.$disconnect();
});

let seq = 0;
const reply = (userId: string, at: Date, id = `evt_${++seq}`): MasterBoxEvent => ({
  id,
  type: 'message.created',
  data: { customer_id: userId, message: { direction: 'outbound', sender: { type: 'agent' }, created_at: at.toISOString() } },
});
const read = (userId: string): MasterBoxEvent => ({ id: `evt_${++seq}`, type: 'message.read', data: { customer_id: userId } });
const lines = (userId: string) =>
  ctx.prisma.notification.findMany({ where: { userId, kind: 'SUPPORT_REPLY' }, orderBy: { createdAt: 'asc' }, select: { readAt: true, createdAt: true } });
const minutes = (base: Date, n: number) => new Date(base.getTime() + n * 60_000);

test('staff replies are one 客服回覆了你 line until the driver reads them in the chat', async () => {
  const driver = await createDriver(ctx);
  const start = new Date('2026-11-20T08:00:00Z');
  await ctx.masterboxWebhook.handle(reply(driver, start), start);
  await ctx.masterboxWebhook.handle(reply(driver, minutes(start, 1)), minutes(start, 1));
  assert.equal((await lines(driver)).length, 1, 'two messages, one line');
  assert.equal((await ctx.notifications.list(driver, minutes(start, 2))).unread, 1);

  await ctx.masterboxWebhook.handle(read(driver), minutes(start, 2));
  const [line] = await lines(driver);
  assert.notEqual(line.readAt, null);

  await ctx.masterboxWebhook.handle(reply(driver, minutes(start, 3)), minutes(start, 3));
  assert.equal((await lines(driver)).filter((row) => row.readAt === null).length, 1, 'a later reply is a new line');
});

test('an event sent again, or one the driver read after it was sent, does not bring the line back', async () => {
  const driver = await createDriver(ctx);
  const start = new Date('2026-11-20T08:00:00Z');
  const first = reply(driver, start, 'evt_same');
  await ctx.masterboxWebhook.handle(first, start);
  await ctx.masterboxWebhook.handle(read(driver), minutes(start, 5));
  await ctx.masterboxWebhook.handle(first, minutes(start, 30));
  await ctx.masterboxWebhook.handle(reply(driver, minutes(start, 2)), minutes(start, 31));
  const rows = await lines(driver);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0].readAt, null);
});

test('nothing for a customer who is not ours, or a driver who turned 客服 notifications off', async () => {
  const start = new Date('2026-11-20T08:00:00Z');
  await ctx.masterboxWebhook.handle(reply('someone-else', start), start);
  assert.equal(await ctx.prisma.notification.count(), 0);

  const driver = await createDriver(ctx);
  await ctx.prisma.user.update({ where: { id: driver }, data: { notificationsOff: ['SUPPORT'] } });
  await ctx.masterboxWebhook.handle(reply(driver, start), start);
  assert.equal((await lines(driver)).length, 0);
});

test('what the driver sends brings no line', async () => {
  const driver = await createDriver(ctx);
  const start = new Date('2026-11-20T08:00:00Z');
  await ctx.masterboxWebhook.handle(
    { id: 'evt_in', type: 'message.created', data: { customer_id: driver, message: { direction: 'inbound', sender: { type: 'guest' }, created_at: start.toISOString() } } },
    start,
  );
  assert.equal((await lines(driver)).length, 0);
});

test('a published 名片頁 goes to MasterBox as the 名片連結; unpublished or taken down, it is taken off', async () => {
  const driver = await createDriver(ctx);
  const sent: Array<{ attributes: Record<string, string | null> }> = [];
  const masterbox = new MasterBoxCustomers(ctx.prisma, loadConfig({ MASTERBOX_APP_ID: 'app_1', MASTERBOX_API_KEY: 'key_1' }));
  masterbox.fetcher = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return new Response(null, { status: 200 });
  };
  const { code } = await ctx.profilePages.ensurePage(driver);

  assert.equal(await masterbox.syncNow(driver), 'ok');
  assert.equal(sent.at(-1)?.attributes.card_url, null, 'not published yet');

  await ctx.prisma.profilePage.update({ where: { code }, data: { published: true } });
  await masterbox.syncNow(driver);
  assert.equal(sent.at(-1)?.attributes.card_url, `${loadConfig({}).publicBaseUrl}/p/${code}`);

  await ctx.profilePages.staffBlock(driver, 'complaint');
  await masterbox.syncNow(driver);
  assert.equal(sent.at(-1)?.attributes.card_url, null, 'taken down');
});
