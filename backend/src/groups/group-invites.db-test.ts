import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, rejectsWith, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';

let ctx: TestContext;
const DAY = 24 * 60 * 60 * 1000;
const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16)]).toString('base64')}`;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 100);
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

test('a dispatcher adds a WhatsApp link, a WeChat group QR and a personal WeChat QR', async () => {
  const owner = await createDriver(ctx, '小馮');
  await ctx.groupInvites.create(owner, { platform: 'WHATSAPP', name: '中港車 WhatsApp', inviteUrl: 'https://chat.whatsapp.com/AbCdEf1234567', showOnClaimPage: true });
  await ctx.groupInvites.create(owner, { platform: 'WECHAT', name: '中港車效益拼單群', qrImage: png, showOnClaimPage: true });
  const list = await ctx.groupInvites.create(owner, { platform: 'WECHAT_CONTACT', name: '加我微信拉你入群', qrImage: png, showOnClaimPage: true });
  assert.equal(list.length, 3);
  const group = list.find((i) => i.platform === 'WECHAT')!;
  const contact = list.find((i) => i.platform === 'WECHAT_CONTACT')!;
  assert.ok(group.expiresAt, 'a WeChat group QR expires');
  assert.equal(contact.expiresAt, null, 'a personal QR does not');
  assert.ok((await ctx.groupInvites.qrImage(group.id))?.mime === 'image/png');
});

test('a WeChat group QR disappears from the claim page after seven days', async () => {
  const owner = await createDriver(ctx);
  await ctx.groupInvites.create(owner, { platform: 'WECHAT', name: '群', qrImage: png, showOnClaimPage: true });
  const later = new Date(Date.now() + 8 * DAY);
  assert.equal((await ctx.groupInvites.forClaimPage(owner)).length, 1);
  assert.equal((await ctx.groupInvites.forClaimPage(owner, later)).length, 0);
  const [invite] = await ctx.groupInvites.list(owner, later);
  assert.equal(invite.expired, true);
  assert.equal(await ctx.groupInvites.qrImage(invite.id, later), null);

  const renewed = await ctx.groupInvites.update(owner, invite.id, { qrImage: png }, later);
  assert.equal(renewed[0].expired, false, 'a new QR starts a new seven days');
});

test('the claim page offers the groups the dispatcher chose to show', async () => {
  const owner = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const [shown] = await ctx.groupInvites.create(owner, { platform: 'WHATSAPP', name: '公開群', inviteUrl: 'https://chat.whatsapp.com/AbCdEf1234567', showOnClaimPage: true });
  const hidden = await ctx.groupInvites.create(owner, { platform: 'WECHAT_CONTACT', name: '私人', qrImage: png, showOnClaimPage: true });
  await ctx.groupInvites.update(owner, hidden[1].id, { showOnClaimPage: false });
  const order = await ctx.orders.create(owner, sampleOrder);

  const view = await ctx.orders.getByCode(order.code);
  assert.deepEqual(view.groupInvites.map((g) => g.name), [shown.name]);

  const won = await ctx.orders.claim(order.code, driver);
  assert.match(String((won.order as { dispatcherPhone?: string }).dispatcherPhone), /^\+852 9/);
  assert.equal('dispatcherPhone' in (await ctx.orders.getByCode(order.code)), false, 'others do not get the phone');
});

test('only real images, only your own groups, at most five', async () => {
  const owner = await createDriver(ctx);
  const other = await createDriver(ctx);
  await rejectsWith(ctx.groupInvites.create(owner, { platform: 'WECHAT', name: '假圖', qrImage: 'data:image/png;base64,PHN2Zz4=', showOnClaimPage: true }), 'QR_IMAGE_INVALID');
  const [mine] = await ctx.groupInvites.create(owner, { platform: 'WECHAT_CONTACT', name: '我', qrImage: png, showOnClaimPage: true });
  await rejectsWith(ctx.groupInvites.remove(other, mine.id), 'GROUP_INVITE_NOT_FOUND');
  for (let i = 0; i < 4; i += 1) await ctx.groupInvites.create(owner, { platform: 'WECHAT_CONTACT', name: `我${i}`, qrImage: png, showOnClaimPage: true });
  await rejectsWith(ctx.groupInvites.create(owner, { platform: 'WECHAT_CONTACT', name: '第六', qrImage: png, showOnClaimPage: true }), 'GROUP_INVITE_LIMIT');
});
