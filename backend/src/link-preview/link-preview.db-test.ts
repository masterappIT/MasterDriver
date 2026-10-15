import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { AppConfig } from '../config';
import type { MediaStorage } from '../storage/media-storage';
import { formatPickup } from '../common/hong-kong-time';
import { createDriver, daysFromNow, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';
import { LinkPreviewService } from './link-preview.service';

let ctx: TestContext;
let previews: LinkPreviewService;
const noStorage: MediaStorage = { available: false, put: async () => {}, read: async () => null, remove: async () => {} };

before(async () => {
  ctx = await setupDatabase();
  previews = new LinkPreviewService(ctx.prisma, noStorage, { publicBaseUrl: 'https://md.test' } as AppConfig);
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 10);
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

const GENERIC = 'MasterDriver 跨境師傅幫｜跨境司機派單、接單、獲客';

test('a published 名片頁 gets the driver’s own preview; unpublished, taken down or unknown gets the generic one', async () => {
  const owner = await createDriver(ctx, '陳師傅');
  await ctx.prisma.driverProfile.update({ where: { userId: owner }, data: { vehicleType: '埃爾法', color: '黑', seats: 7, plateType: 'DUAL' } });
  const page = await ctx.profilePages.update(owner, { published: true, intro: '十年經驗，準時' });
  await ctx.prisma.profilePage.update({ where: { code: page.code }, data: { routes: ['深圳灣 往返 香港機場'] } });

  const shown = await previews.page(`/p/${page.code}`);
  assert.equal(shown.title, '陳師傅｜跨境司機名片', 'old routes are stored but the page no longer shows them');
  assert.ok(!JSON.stringify(await previews.cardData('p', page.code)).includes('深圳灣'), 'nor does the card');
  assert.equal(shown.description, '埃爾法・黑・兩地牌 7 座。點開直接約車，不用註冊。');
  assert.equal(shown.url, `https://md.test/p/${page.code}`);
  assert.match(shown.image, new RegExp(`^https://md\\.test/api/public/link-preview/card/p/${page.code}\\.jpg\\?v=`));
  assert.ok(await previews.card('p', page.code), 'a card image is drawn');

  await ctx.profilePages.update(owner, { published: false });
  assert.equal((await previews.page(`/p/${page.code}`)).title, GENERIC);
  assert.equal(await previews.card('p', page.code), null, 'no card: the generic picture');

  await ctx.profilePages.update(owner, { published: true });
  await ctx.profilePages.staffBlock(owner, '照片含廣告');
  assert.equal((await previews.page(`/p/${page.code}`)).title, GENERIC);

  assert.equal((await previews.page('/p/NOTREAL1')).title, GENERIC);
  assert.equal((await previews.page('/../etc/passwd')).url, 'https://md.test/');
});

test('the admin’s 名片頁 SEO template sets the title', async () => {
  const owner = await createDriver(ctx, '陳師傅');
  const page = await ctx.profilePages.update(owner, { published: true });
  await ctx.prisma.seoPageSetting.upsert({ where: { page: 'PROFILE' }, update: { title: '{司機}・跨境接送' }, create: { page: 'PROFILE', title: '{司機}・跨境接送' } });
  assert.equal((await previews.page(`/p/${page.code}`)).title, '陳師傅・跨境接送');
});

test('a confirmation link names who sent it, and nothing of the passenger or the trip', async () => {
  const dispatcher = await createDriver(ctx, '李師傅');
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  const confirmCode = order.links.passengerConfirm.split('/c/')[1];

  const meta = await previews.page(`/c/${confirmCode}`);
  assert.equal(meta.title, '李師傅為你安排的行程');
  assert.equal(meta.description, '點開確認時間與上車地點。行程由李師傅負責。');
  const everything = JSON.stringify(meta);
  for (const secret of [sampleOrder.passengerContact, sampleOrder.origin, sampleOrder.destination, '9876']) {
    assert.ok(!everything.includes(secret), `the preview never carries ${secret}`);
  }
  assert.ok(await previews.card('c', confirmCode));

  await ctx.prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
  assert.equal((await previews.page(`/c/${confirmCode}`)).title, GENERIC, 'a cancelled trip has no card');
});

test('a confirmation card is about the dispatcher: their car only when they drive it, nothing of the driver who claimed it', async () => {
  const dispatcher = await createDriver(ctx, '李師傅');
  const driver = await createDriver(ctx, '張師傅');
  await ctx.prisma.driverProfile.update({ where: { userId: dispatcher }, data: { vehicleType: '商務車', seats: 7, plateType: 'DUAL' } });
  await ctx.prisma.driverProfile.update({ where: { userId: driver }, data: { vehicleType: '埃爾法', seats: 7 } });
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  const confirmCode = order.links.passengerConfirm.split('/c/')[1];

  // Nobody has it yet, then another driver claims it: the dispatcher's name, no car of anyone's.
  for (const step of ['open', 'claimed by another']) {
    if (step === 'claimed by another') await ctx.orders.claim(order.code, driver);
    const card = await previews.cardData('c', confirmCode);
    assert.equal(card?.name, '李師傅', step);
    assert.equal(card?.vehicle, null, step);
    assert.equal(card?.photoKey, null, step);
    assert.ok(!JSON.stringify(card).includes('張師傅'), `${step}: never the claiming driver`);
    assert.ok(!JSON.stringify(card).includes('埃爾法'), `${step}: never the claiming driver’s car`);
    assert.equal(card?.owner?.line, '行程由李師傅負責，有問題請找李師傅', step);
    assert.deepEqual(await previews.squareData('c', confirmCode), { kind: 'confirm' }, `${step}: 為你安排的行程, no initial`);
  }

  // They drive it themselves: their own car.
  await ctx.prisma.order.update({ where: { id: order.id }, data: { claimedById: dispatcher } });
  assert.equal((await previews.cardData('c', confirmCode))?.vehicle, '7座商務車 · 兩地牌');
  assert.equal((await previews.squareData('c', confirmCode))?.kind, 'driver', 'their own car, or their initial');
});

test('a confirmation card counts the trips the dispatcher arranged, and offers their 名片頁 only when it is public', async () => {
  const dispatcher = await createDriver(ctx, '李師傅');
  const driver = await createDriver(ctx, '張師傅');
  const done = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.prisma.order.update({ where: { id: done.id }, data: { status: 'COMPLETED', claimedById: driver } });
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  const confirmCode = order.links.passengerConfirm.split('/c/')[1];

  let card = await previews.cardData('c', confirmCode);
  assert.equal(card?.completedTrips, 1, 'arranged, though another driver drove it');
  assert.equal(card?.owner?.next, null, 'no public 名片頁 yet');

  await ctx.profilePages.update(dispatcher, { published: true });
  card = await previews.cardData('c', confirmCode);
  assert.equal(card?.owner?.next, '下次用車，可直接在李師傅的名片頁約');

  await ctx.profilePages.staffBlock(dispatcher, '照片含廣告');
  assert.equal((await previews.cardData('c', confirmCode))?.owner?.next, null, 'taken down: not offered');
});

test('every visitor of a link gets its tags with the square; a link without its own keeps the home tags', async () => {
  const owner = await createDriver(ctx, '陳師傅');
  const page = await ctx.profilePages.update(owner, { published: true });

  const tags = await previews.tags(`/p/${page.code}`);
  assert.equal(tags?.title, '陳師傅｜跨境司機名片');
  assert.equal(tags?.square, true);
  assert.match(tags?.image ?? '', new RegExp(`^https://md\\.test/api/public/link-preview/square/p/${page.code}\\.jpg\\?v=`));
  assert.ok(await previews.square('p', page.code), 'the square is drawn');

  assert.equal(await previews.tags('/p/NOTREAL1'), null);
  assert.equal(await previews.tags('/'), null, 'the home page keeps the tags it was built with');
  assert.equal(await previews.square('p', 'NOTREAL1'), null, 'no square: the home picture');

  const home = await previews.page('/');
  assert.equal(home.title, GENERIC);
  assert.equal(home.image, 'https://md.test/share-card.jpg', 'robots get the wide home picture');
});

test('a 搶單 link says when, where, the car and the driver price, whose order it is, and nothing of the passenger', async () => {
  const dispatcher = await createDriver(ctx, '李師傅');
  const driver = await createDriver(ctx, '張師傅');
  const pickupAt = daysFromNow(2);
  const order = await ctx.orders.create(dispatcher, {
    ...sampleOrder,
    pickupAt,
    vehicleType: '7座',
    driverPrice: { amount: 600, currency: 'CNY' },
    passengerPrice: { amount: 980, currency: 'HKD' },
    passengerName: '王小姐',
  });

  const meta = await previews.page(`/o/${order.code}`);
  assert.equal(meta.title, '【有單】深圳灣口岸→香港國際機場');
  assert.equal(meta.description, `${formatPickup(new Date(pickupAt))}・7座・RMB¥600。李師傅出的單，點開搶單，先搶先得。`);
  assert.equal(meta.square, true, 'no wide card: the square for every app');
  assert.match(meta.image, new RegExp(`/square/o/${order.code}\\.jpg\\?v=`));
  const everything = JSON.stringify([meta, await previews.tags(`/o/${order.code}`), await previews.squareData('o', order.code)]);
  for (const secret of ['9876', '980', '王小姐']) assert.ok(!everything.includes(secret), `never ${secret}`);
  assert.deepEqual(await previews.squareData('o', order.code), { kind: 'order', badge: '有單', when: formatPickup(new Date(pickupAt)).replace(/（.）/, ' ') });
  assert.ok(await previews.square('o', order.code));

  await ctx.orders.claim(order.code, driver);
  assert.equal(await previews.tags(`/o/${order.code}`), null, 'taken: no preview of its own');
  assert.equal((await previews.page(`/o/${order.code}`)).title, GENERIC);
});
