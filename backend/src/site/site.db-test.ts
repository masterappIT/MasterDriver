import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, rejectsWith, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';

let ctx: TestContext;
const DAY = 24 * 60 * 60 * 1000;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
  await seedPlans(ctx, 1000);
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

test('public settings show the announcement only when switched on', async () => {
  await ctx.site.updateAppSetting({ upgradeUrl: 'https://mt.example/demo', announcementText: '系統維護 22:00' }, 'test');
  assert.equal((await ctx.site.publicSettings()).announcement, null);
  await ctx.site.updateAppSetting({ announcementEnabled: true }, 'test');
  const settings = await ctx.site.publicSettings();
  assert.equal(settings.announcement, '系統維護 22:00');
  assert.equal(settings.upgradeUrl, 'https://mt.example/demo');
});

test('the logo is uploaded as a real picture, served to public pages, and can be replaced or removed', async () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(64, 7)]);
  const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
  assert.equal((await ctx.site.publicSettings()).logoUrl, null);

  const { logoUrl } = await ctx.site.setLogo(dataUrl, 'test');
  assert.match(logoUrl ?? '', /^\/api\/public\/logo\?v=\d+$/);
  assert.equal((await ctx.site.publicSettings()).logoUrl, logoUrl);
  const stored = await ctx.site.logoImage();
  assert.equal(stored?.mime, 'image/png');
  assert.ok(Buffer.from(stored!.image).equals(png));
  assert.equal('image' in (await ctx.site.appSetting()), false, 'reading the settings never carries the picture');

  const html = `data:image/png;base64,${Buffer.from('<svg onload=alert(1)>').toString('base64')}`;
  await rejectsWith(ctx.site.setLogo(html, 'test'), 'LOGO_IMAGE_INVALID');
  await rejectsWith(ctx.site.setLogo('data:image/svg+xml;base64,PHN2Zz4=', 'test'), 'LOGO_IMAGE_INVALID');

  assert.equal((await ctx.site.removeLogo()).logoUrl, null);
  assert.equal(await ctx.site.logoImage(), null);
});

test('SEO is closed to crawlers until indexing is switched on', async () => {
  assert.equal((await ctx.site.publicSeo('HOME')).robots, 'noindex, nofollow');
  assert.equal(await ctx.site.robots(), 'User-agent: *\nDisallow: /\n');
  await ctx.site.updateSeoSite({ allowIndexing: true, canonicalOrigin: 'https://md.example', sitemapEnabled: true }, 'test');
  await ctx.site.updateSeoPage('HOME', { title: 'MasterDriver 跨境師傅幫｜有單就派，有空就接' });
  const home = await ctx.site.publicSeo('HOME');
  assert.equal(home.robots, 'index, follow');
  assert.equal(home.title, 'MasterDriver 跨境師傅幫｜有單就派，有空就接');
  assert.ok((await ctx.site.robots()).includes('Disallow: /o/'));
});

test('only live ads are served, best first, and clicks count and return the stored link', async () => {
  const now = new Date();
  await ctx.site.createAd({ position: 'HOME', title: '低', body: '', imageUrl: '', linkUrl: 'https://mt.example/a', priority: 1, active: true });
  const topId = await ctx.site.createAd({ position: 'HOME', title: '高', body: '', imageUrl: '', linkUrl: 'https://mt.example/b', priority: 9, active: true });
  await ctx.site.createAd({ position: 'HOME', title: '停用', body: '', imageUrl: '', linkUrl: 'https://mt.example/c', priority: 99, active: false });
  await ctx.site.createAd({
    position: 'HOME', title: '過期', body: '', imageUrl: '', linkUrl: 'https://mt.example/d', priority: 99, active: true,
    startsAt: new Date(now.getTime() - 2 * DAY).toISOString(), endsAt: new Date(now.getTime() - DAY).toISOString(),
  });
  await ctx.site.createAd({ position: 'CLAIM_PAGE', title: '別處', body: '', imageUrl: '', linkUrl: 'https://mt.example/e', priority: 99, active: true });

  const live = await ctx.site.liveAds('HOME');
  assert.deepEqual(live.map((ad) => ad.title), ['高', '低']);
  assert.equal(live[0].clickUrl, `/api/public/ads/${topId}/click`);

  await ctx.site.recordImpressions([topId, topId, 'unknown-id']);
  assert.equal(await ctx.site.click(topId), 'https://mt.example/b');
  assert.equal(await ctx.site.click('unknown-id'), null);
  const listed = (await ctx.site.listAds()).find((ad) => ad.id === topId)!;
  assert.deepEqual(listed.last30Days, { impressions: 1, clicks: 1 });
});

test('the 升級 entry shows only past 30 trips in 30 days: a 接駁 trip counts once, cancelled ones not at all', async () => {
  const dispatcher = await createDriver(ctx);
  const orders = [];
  for (let i = 0; i < 31; i += 1) orders.push(await ctx.orders.create(dispatcher, sampleOrder));
  assert.equal((await ctx.site.upgradeOffer(dispatcher)).upgradeUrl, null, 'no link set in the admin');

  await ctx.site.updateAppSetting({ upgradeUrl: 'https://mt.example/demo' }, 'test');
  assert.equal((await ctx.site.upgradeOffer(dispatcher)).upgradeUrl, 'https://mt.example/demo');
  assert.equal((await ctx.site.upgradeOffer(dispatcher, new Date(Date.now() + 31 * DAY))).upgradeUrl, null, 'older than 30 days');

  await ctx.orders.cancel(dispatcher, orders[0].id);
  assert.equal((await ctx.site.upgradeOffer(dispatcher)).upgradeUrl, null, '30 left is not more than 30');
  await ctx.orders.create(dispatcher, { ...sampleOrder, pickupAt: '2026-10-15T16:00:00+08:00', origin: sampleOrder.destination, destination: '澳門', afterOrderId: orders[1].id });
  assert.equal((await ctx.site.upgradeOffer(dispatcher)).upgradeUrl, null, 'a second leg is the same trip');
  assert.equal((await ctx.site.upgradeOffer(await createDriver(ctx))).upgradeUrl, null);
});

test('busy, growing, paying dispatchers rank first; sales notes stick', async () => {
  const busy = await createDriver(ctx, '大車隊');
  const small = await createDriver(ctx, '個體戶');
  const drivers = await Promise.all([1, 2, 3].map((i) => createDriver(ctx, `司機${i}`)));
  for (const driver of drivers) {
    const order = await ctx.orders.create(busy, sampleOrder);
    await ctx.orders.claim(order.code, driver);
  }
  await ctx.orders.create(small, sampleOrder);
  await ctx.credits.credit(busy, 10000, { type: 'TOPUP', source: 'MANUAL', createdBy: 'test' });

  const { items } = await ctx.site.leads({ days: 30 });
  assert.deepEqual(items.map((lead) => lead.name), ['大車隊', '個體戶']);
  assert.equal(items[0].stats.drivers, 3);
  assert.equal(items[0].scoreParts.paying, 10);

  await ctx.site.updateLead(busy, { status: 'CONTACTED', note: '已約下週演示' }, 'admin:sales');
  const contacted = await ctx.site.leads({ days: 30, status: 'CONTACTED' });
  assert.deepEqual(contacted.items.map((lead) => [lead.name, lead.note]), [['大車隊', '已約下週演示']]);
  assert.deepEqual((await ctx.site.leads({ days: 30, status: 'NEW' })).items.map((lead) => lead.name), ['個體戶']);
});
