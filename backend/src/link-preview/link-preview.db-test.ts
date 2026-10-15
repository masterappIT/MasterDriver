import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import type { AppConfig } from '../config';
import type { MediaStorage } from '../storage/media-storage';
import { createDriver, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';
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

const GENERIC = '跨境師傅幫｜有單就派，有空就接';

test('a published 名片頁 gets the driver’s own preview; unpublished, taken down or unknown gets the generic one', async () => {
  const owner = await createDriver(ctx, '陳師傅');
  const page = await ctx.profilePages.update(owner, { published: true, intro: '十年經驗，準時' });
  await ctx.prisma.profilePage.update({ where: { code: page.code }, data: { routes: ['深圳灣 往返 香港機場'] } });

  const shown = await previews.page(`/p/${page.code}`);
  assert.equal(shown.title, '陳師傅｜跨境師傅幫', 'old routes are stored but the page no longer shows them');
  assert.ok(!JSON.stringify(await previews.cardData('p', page.code)).includes('深圳灣'), 'nor does the card');
  assert.equal(shown.description, '十年經驗，準時');
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
  assert.equal(meta.title, '李師傅為你安排的行程｜跨境師傅幫');
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
  }

  // They drive it themselves: their own car.
  await ctx.prisma.order.update({ where: { id: order.id }, data: { claimedById: dispatcher } });
  assert.equal((await previews.cardData('c', confirmCode))?.vehicle, '7座商務車 · 兩地牌');
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
