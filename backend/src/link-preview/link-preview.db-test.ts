import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { carpoolCreateSchema, carpoolSeatCreateSchema, dealBookingCreateSchema, dealCreateSchema } from '@masterdriver/shared';
import type { AppConfig } from '../config';
import type { MediaStorage } from '../storage/media-storage';
import { formatPickup } from '../common/hong-kong-time';
import { createDriver, daysFromNow, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';
import { LinkPreviewService } from './link-preview.service';
import { SearchPageService } from './search-page.service';

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

test('a 拼車 link says when, where and the price a seat, whose carpool it is, never the seats left nor a passenger', async () => {
  const owner = await createDriver(ctx, '陳師傅');
  await ctx.prisma.driverProfile.update({ where: { userId: owner }, data: { seats: 7, vehicleType: '7座' } });
  const pickupAt = new Date(daysFromNow(2));
  const carpool = await ctx.carpools.create(
    owner,
    carpoolCreateSchema.parse({ pickupAt: pickupAt.toISOString(), origin: '深圳灣口岸', destination: '香港國際機場', seats: 4, seatPrice: { amount: 200, currency: 'HKD' } }),
  );
  const seat = await ctx.carpools.createSeat(
    carpool.code,
    carpoolSeatCreateSchema.parse({ passengers: 2, pickupPoint: '南山海岸城', passengerName: '王小姐', passengerContact: '+852 61239876' }),
    '10.0.0.1',
  );

  const meta = await previews.page(`/r/${carpool.code}`);
  assert.equal(meta.title, `【拼車】${formatPickup(pickupAt)} 深圳灣口岸 → 香港國際機場`);
  assert.equal(meta.description, '每位 HK$200。陳師傅開的拼車，點開報位，不用註冊。');
  assert.equal(meta.square, true);
  assert.match(meta.image, new RegExp(`/square/r/${carpool.code}\\.jpg\\?v=`));
  assert.deepEqual(await previews.squareData('r', carpool.code), { kind: 'driver', name: '陳師傅', photoKey: null });
  assert.ok(await previews.square('r', carpool.code));
  const everything = JSON.stringify([meta, await previews.tags(`/r/${carpool.code}`)]);
  for (const secret of ['剩', '王小姐', '9876', '南山海岸城']) assert.ok(!everything.includes(secret), `never ${secret}`);

  assert.equal(await previews.tags(`/s/${seat.code}`), null, "a passenger's own link keeps the home tags");
  await ctx.carpools.close(owner, carpool.id);
  assert.equal(await previews.tags(`/r/${carpool.code}`), null, 'closed: no preview of its own');
  assert.equal((await previews.page(`/r/${carpool.code}`)).title, GENERIC);
});

test('a 特價車 link says when, where, the price and whose deal it is, only while it takes bookings', async () => {
  const owner = await createDriver(ctx, '陳師傅');
  const pickupAt = new Date(daysFromNow(2));
  const deal = await ctx.deals.create(
    owner,
    dealCreateSchema.parse({ pickupAt: pickupAt.toISOString(), origin: '深圳灣口岸', destination: '香港國際機場', price: 350, currency: 'CNY', originalPrice: 500, maxBookings: 1 }),
  );

  const meta = await previews.page(`/d/${deal.code}`);
  assert.equal(meta.title, `【特價車】${formatPickup(pickupAt)} 深圳灣口岸 → 香港國際機場`);
  assert.equal(meta.description, '包車 RMB¥350（原價 RMB¥500）。陳師傅的特價車，點開預約，不用註冊。');
  assert.match(meta.image, new RegExp(`/square/d/${deal.code}\\.jpg\\?v=`));
  assert.deepEqual(await previews.squareData('d', deal.code), { kind: 'driver', name: '陳師傅', photoKey: null });

  await ctx.deals.createBooking(
    deal.code,
    dealBookingCreateSchema.parse({ pickupAt: pickupAt.toISOString(), passengers: 2, passengerName: '王小姐', passengerContact: '+852 61239876' }),
    '10.0.0.1',
  );
  assert.equal(await previews.tags(`/d/${deal.code}`), null, 'full: no preview of its own');
  assert.equal((await previews.page(`/d/${deal.code}`)).title, GENERIC);
});

test('search engines: nothing is indexed until the admin allows it, and a 名片頁 only when its driver lets it be found', async () => {
  const pages = new SearchPageService(ctx.prisma, previews, { publicBaseUrl: 'https://md.test' } as AppConfig);
  const owner = await createDriver(ctx, '陳師傅');
  await ctx.prisma.driverProfile.update({ where: { userId: owner }, data: { vehicleType: '埃爾法', seats: 7, hkMacauPhone: '+852 98765432' } });
  await ctx.profilePages.update(owner, { published: true, intro: '深圳灣過關快', languages: ['粵語'] });
  const page = await ctx.prisma.profilePage.findUniqueOrThrow({ where: { userId: owner } });

  // Indexing off (the default): every page says noindex and the sitemap is off.
  for (const path of ['/', `/p/${page.code}`, '/o/abcdEFGH', '/app']) {
    const off = await pages.page(path);
    assert.equal(off.indexable, false, path);
    assert.match(off.html, /<meta name="robots" content="noindex, nofollow" \/>/);
  }
  assert.equal(await pages.sitemap(), null);

  await ctx.prisma.seoSiteSetting.upsert({
    where: { id: 'default' },
    update: {},
    create: { id: 'default', allowIndexing: true, sitemapEnabled: true, canonicalOrigin: 'https://md.example', googleVerification: 'g-code', baiduVerification: 'b-code' },
  });
  const home = await pages.page('/');
  assert.equal(home.indexable, true);
  assert.match(home.html, /<link rel="canonical" href="https:\/\/md.example\/" \/>/);
  assert.match(home.html, /<meta name="google-site-verification" content="g-code" \/>/);
  assert.match(home.html, /<meta name="baidu-site-verification" content="b-code" \/>/);
  assert.match(home.html, /有單就派，有空就接/);

  // Published but not chosen by its driver: still noindex, and not in the sitemap.
  assert.equal((await pages.page(`/p/${page.code}`)).indexable, false);
  assert.ok(!(await pages.sitemap())!.includes('/p/'));

  await ctx.profilePages.update(owner, { searchable: true });
  const card = await pages.page(`/p/${page.code}`);
  assert.equal(card.indexable, true);
  assert.match(card.html, /<h1>陳師傅｜跨境司機名片<\/h1>/);
  assert.match(card.html, /深圳灣過關快/);
  assert.ok(!card.html.includes('98765432'), 'no phone numbers');
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: owner } });
  assert.ok(!card.html.includes(user.phone), 'not the sign-in number either');
  assert.ok((await pages.sitemap())!.includes(`<loc>https://md.example/p/${page.code}</loc>`));

  // Trip links never: a 特價車, a 搶單 or a passenger's link is noindex whatever the settings.
  for (const path of ['/d/abcdEFGH', '/c/abcdEFGH', '/o/abcdEFGH']) assert.equal((await pages.page(path)).indexable, false, path);

  // Taken down: out of the index and the sitemap.
  await ctx.profilePages.staffBlock(owner, '投訴');
  assert.equal((await pages.page(`/p/${page.code}`)).indexable, false);
  assert.ok(!(await pages.sitemap())!.includes('/p/'));
});

test('link previews are the same whatever the search settings say', async () => {
  const owner = await createDriver(ctx, '陳師傅');
  await ctx.profilePages.update(owner, { published: true });
  const page = await ctx.prisma.profilePage.findUniqueOrThrow({ where: { userId: owner } });
  const before = [await previews.page('/'), await previews.page(`/p/${page.code}`)];
  await ctx.prisma.seoSiteSetting.upsert({ where: { id: 'default' }, update: { allowIndexing: true }, create: { id: 'default', allowIndexing: true } });
  await ctx.profilePages.update(owner, { searchable: true });
  assert.deepEqual([await previews.page('/'), await previews.page(`/p/${page.code}`)], before);
});
