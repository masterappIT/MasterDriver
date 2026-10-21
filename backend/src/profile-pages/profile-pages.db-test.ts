import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { createDriver, rejectsWith, sampleOrder, seedPlans, setupDatabase, type TestContext } from '../test/database';

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

const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 1)]);
const inAWeek = () => new Date(Date.now() + 7 * 86_400_000).toISOString().replace('Z', '+00:00');
const request = () => ({
  pickupAt: inAWeek(),
  origin: '香港國際機場',
  destination: '深圳灣口岸',
  passengers: 3,
  luggage: 2,
  passengerName: '王小姐',
  passengerContact: '+852 91234567',
  passengerWechat: 'wang-test',
});

async function publishedPage(name = '陳師傅') {
  const userId = await createDriver(ctx, name);
  const page = await ctx.profilePages.update(userId, { published: true, intro: '十年跨境經驗', routes: ['香港 ⇄ 深圳灣'], languages: ['粵語', '普通話'] });
  return { userId, code: page.code };
}

test('a page is private until published, shows what the driver wrote, and counts only trips finished in the tool', async () => {
  const userId = await createDriver(ctx, '陳師傅');
  const draft = await ctx.profilePages.mine(userId);
  assert.equal(draft.published, false);
  assert.match(draft.url, /^https:\/\/md\.test\/p\/[A-Za-z0-9]{8}$/);
  assert.equal((await ctx.profilePages.mine(userId)).code, draft.code, 'one page per user');
  await rejectsWith(ctx.profilePages.publicPage(draft.code), 'PROFILE_PAGE_NOT_FOUND');
  assert.equal((await ctx.profilePages.publicPage(draft.code, userId)).mine, true, 'the owner previews it');

  await ctx.profilePages.update(userId, { published: true, intro: '十年跨境經驗', routes: ['香港 ⇄ 深圳灣'], whatsapp: '+852 6000 0000' });
  const dispatcher = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(order.code, userId);
  assert.equal((await ctx.profilePages.publicPage(draft.code)).completedTrips, 0, 'claimed is not completed');
  await ctx.orders.complete(userId, order.id);

  const page = await ctx.profilePages.publicPage(draft.code);
  assert.deepEqual([page.name, page.intro, page.routes, page.whatsapp, page.completedTrips], ['陳師傅', '十年跨境經驗', ['香港 ⇄ 深圳灣'], '+852 6000 0000', 1]);
  assert.equal('userId' in page, false);

  const noDetails = (await ctx.prisma.user.create({ data: { countryCode: '+852', phone: '60009999' } })).id;
  await rejectsWith(ctx.profilePages.update(noDetails, { published: true }), 'PROFILE_REQUIRED');
});

test('photos: real pictures only, one per page, public once the page is, gone from storage when removed', async () => {
  const { userId, code } = await publishedPage();
  await rejectsWith(ctx.profilePages.addPhoto(userId, Buffer.from('<!doctype html><script>')), 'PHOTO_TYPE');
  await rejectsWith(ctx.profilePages.addPhoto(userId, Buffer.concat([Buffer.from('\0\0\0\x18ftypisom', 'latin1'), Buffer.alloc(64)])), 'PHOTO_TYPE');
  let page = await ctx.profilePages.addPhoto(userId, jpeg(10));
  await rejectsWith(ctx.profilePages.addPhoto(userId, jpeg(20)), 'PHOTO_LIMIT');
  assert.equal(page.photos.length, 1);

  const first = page.photos[0];
  assert.ok((await ctx.profilePages.photo(code, first.id)).bytes.equals(jpeg(10)));
  const key = (await ctx.prisma.profilePhoto.findUniqueOrThrow({ where: { id: first.id } })).storageKey;
  assert.match(key, /^profile\/[a-z0-9]+\/[A-Za-z0-9]{24}\.jpg$/);

  const other = await createDriver(ctx);
  await rejectsWith(ctx.profilePages.removePhoto(other, first.id), 'PHOTO_NOT_FOUND');
  await ctx.profilePages.removePhoto(userId, first.id);
  assert.equal(await ctx.mediaStorage.read(key), null);
  await rejectsWith(ctx.profilePages.photo(code, first.id), 'PHOTO_NOT_FOUND');

  // With the one photo removed, another can take its place.
  page = await ctx.profilePages.addPhoto(userId, jpeg(20));
  await ctx.profilePages.update(userId, { published: false });
  await rejectsWith(ctx.profilePages.photo(code, page.photos[0].id), 'PHOTO_NOT_FOUND');
  assert.ok(await ctx.profilePages.photo(code, page.photos[0].id, userId), 'the owner still sees it');
});

test('the passenger sees the vehicle photos of the driver who has the order, through their link only', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx, '有車照的師傅');
  // Not published: the photos still reach this driver's passengers.
  const photoId = (await ctx.profilePages.addPhoto(driver, jpeg(10))).photos[0].id;
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  const confirmCode = order.links.passengerConfirm.split('/c/')[1];
  const other = await ctx.orders.create(dispatcher, sampleOrder);
  const otherCode = other.links.passengerConfirm.split('/c/')[1];

  await rejectsWith(ctx.profilePages.passengerPhoto(confirmCode, photoId), 'PHOTO_NOT_FOUND');
  await ctx.orders.claim(order.code, driver);
  const page = await ctx.orders.getForPassenger(confirmCode);
  assert.deepEqual(page.driver?.photos, [`/api/c/${confirmCode}/driver-photos/${photoId}`]);
  assert.ok((await ctx.profilePages.passengerPhoto(confirmCode, photoId)).bytes.equals(jpeg(10)));
  await rejectsWith(ctx.profilePages.passengerPhoto(otherCode, photoId), 'PHOTO_NOT_FOUND');

  await ctx.orders.reopen(dispatcher, order.id);
  await rejectsWith(ctx.profilePages.passengerPhoto(confirmCode, photoId), 'PHOTO_NOT_FOUND');
});

test('a booking goes from request to quote to agreement to an order, and the passenger follows it by link', async () => {
  const { userId, code } = await publishedPage();
  const sent = await ctx.profilePages.createBooking(code, { ...request(), source: 'xhs' }, '2.2.2.2');
  assert.match(sent.url, /^https:\/\/md\.test\/b\/[A-Za-z0-9]{16}$/);
  assert.deepEqual(await ctx.profilePages.unread(userId), { count: 1 });

  const [listed] = await ctx.profilePages.bookings(userId);
  assert.deepEqual(
    [listed.status, listed.unread, listed.source, listed.passengerContact, listed.passengerWechat],
    ['PENDING', true, 'xhs', '+852 91234567', 'wang-test'],
  );
  await ctx.profilePages.booking(userId, listed.id);
  assert.deepEqual(await ctx.profilePages.unread(userId), { count: 0 });

  await rejectsWith(ctx.profilePages.passengerAccept(sent.code), 'BOOKING_NOT_OPEN');
  await ctx.profilePages.quote(userId, listed.id, { amount: 900, currency: 'HKD', note: '含隧道費' });
  let seen = await ctx.profilePages.passengerBooking(sent.code);
  assert.deepEqual([seen.status, seen.quote, seen.quoteNote, seen.driverName], ['QUOTED', { amount: 900, currency: 'HKD' }, '含隧道費', '陳師傅']);
  assert.equal('ip' in seen || 'source' in seen, false);

  seen = await ctx.profilePages.passengerAccept(sent.code);
  assert.equal(seen.status, 'ACCEPTED');
  assert.deepEqual(await ctx.profilePages.unread(userId), { count: 1 }, "the passenger's answer is news for the driver");
  // The agreed price stands: no new quote once the passenger has agreed.
  await rejectsWith(ctx.profilePages.quote(userId, listed.id, { amount: 1200, currency: 'HKD' }), 'BOOKING_NOT_OPEN');
  assert.deepEqual((await ctx.profilePages.passengerBooking(sent.code)).quote, { amount: 900, currency: 'HKD' });

  const order = await ctx.orders.create(userId, {
    ...sampleOrder,
    pickupAt: listed.pickupAt,
    origin: listed.origin,
    destination: listed.destination,
    passengerContact: listed.passengerContact,
    bookingId: listed.id,
  });
  seen = await ctx.profilePages.passengerBooking(sent.code);
  assert.equal(seen.status, 'ORDERED');
  assert.equal(seen.confirmUrl, new URL(order.links.passengerConfirm).pathname);
  assert.equal((await ctx.profilePages.booking(userId, listed.id)).orderId, order.id);

  await rejectsWith(ctx.orders.create(userId, { ...sampleOrder, bookingId: listed.id }), 'BOOKING_NOT_OPEN');
  await rejectsWith(ctx.profilePages.quote(userId, listed.id, { amount: 1, currency: 'HKD' }), 'BOOKING_NOT_OPEN');
  await rejectsWith(ctx.profilePages.passengerCancel(sent.code), 'BOOKING_NOT_OPEN');
});

test("這單我自己做 from a booking: one order, the driver's own, and the passenger's link leads to it", async () => {
  const { userId, code } = await publishedPage();
  const sent = await ctx.profilePages.createBooking(code, { ...request(), passengerContact: '+852 91234567' }, '10.0.0.9');
  const [listed] = await ctx.profilePages.bookings(userId);
  await ctx.profilePages.quote(userId, listed.id, { amount: 900, currency: 'HKD' });
  await ctx.profilePages.passengerAccept(sent.code);

  const order = await ctx.orders.create(userId, {
    pickupAt: listed.pickupAt,
    origin: listed.origin,
    destination: listed.destination,
    waypoints: [],
    passengers: listed.passengers,
    luggage: listed.luggage,
    passengerContact: '+852 91234567',
    passengerPrice: { amount: 900, currency: 'HKD' },
    showPassengerPrice: true,
    selfDrive: true,
    bookingId: listed.id,
  });
  assert.equal(order.status, 'ASSIGNED');
  assert.equal(order.selfDrive, true);
  assert.equal(order.fromBooking, true);
  assert.equal((await ctx.orders.create(userId, { ...sampleOrder, selfDrive: true })).fromBooking, false);
  const after = await ctx.profilePages.passengerBooking(sent.code);
  assert.equal(after.status, 'ORDERED');
  assert.ok(after.confirmUrl && order.links.passengerConfirm.endsWith(after.confirmUrl));
  const page = await ctx.orders.getForPassenger(after.confirmUrl.split('/c/')[1]);
  assert.equal(page.price?.amount, 900);
  assert.ok(page.driver, 'the passenger sees the driver at once');
});

test('a 接駁 booking: both sides see it, and the driver makes a 接駁 order from it', async () => {
  const { userId, code } = await publishedPage();
  const direct = await ctx.profilePages.createBooking(code, request(), '4.4.4.4');
  const sent = await ctx.profilePages.createBooking(code, { ...request(), destination: '廣州', transfer: true }, '4.4.4.4');
  assert.equal((await ctx.profilePages.passengerBooking(direct.code)).transfer, false, '直達 unless the passenger asks');
  assert.equal((await ctx.profilePages.passengerBooking(sent.code)).transfer, true);
  const listed = (await ctx.profilePages.bookings(userId)).find((booking) => booking.code === sent.code)!;
  assert.equal(listed.transfer, true);
  await ctx.profilePages.quote(userId, listed.id, { amount: 1500, currency: 'HKD' });
  await ctx.profilePages.passengerAccept(sent.code);

  const order = await ctx.orders.create(userId, {
    ...sampleOrder,
    pickupAt: listed.pickupAt,
    origin: listed.origin,
    destination: listed.destination,
    passengerContact: listed.passengerContact,
    passengerPrice: { amount: 1500, currency: 'HKD' },
    showPassengerPrice: true,
    transfer: { place: '深圳灣口岸', pickupAt: listed.pickupAt, driverPrice: { amount: 600, currency: 'CNY' }, requiredPlates: [], selfDriveLeg: 1 },
    bookingId: listed.id,
  });
  assert.equal(order.journey?.legCount, 2);
  assert.equal((await ctx.profilePages.booking(userId, listed.id)).orderId, order.id);
  const after = await ctx.profilePages.passengerBooking(sent.code);
  assert.equal(after.status, 'ORDERED');
  assert.ok(after.confirmUrl && order.links.passengerConfirm.endsWith(after.confirmUrl));
  assert.equal((await ctx.orders.getForPassenger(after.confirmUrl.split('/c/')[1])).price?.amount, 1500, 'one price for the whole trip');
});

test('a 往返 booking: both sides see the way back, and 來回我自己做 makes both legs the driver\'s', async () => {
  const { userId, code } = await publishedPage();
  const pickupAt = inAWeek();
  const returnPickupAt = new Date(Date.parse(pickupAt) + 8 * 3_600_000).toISOString().replace('Z', '+00:00');
  const sent = await ctx.profilePages.createBooking(code, { ...request(), pickupAt, roundTrip: true, returnPickupAt }, '6.6.6.6');
  const seen = await ctx.profilePages.passengerBooking(sent.code);
  assert.equal(seen.roundTrip, true);
  assert.equal(seen.returnPickupAt, new Date(returnPickupAt).toISOString());
  const listed = (await ctx.profilePages.bookings(userId)).find((booking) => booking.code === sent.code)!;
  assert.equal(listed.roundTrip, true);
  assert.equal(listed.returnPickupAt, seen.returnPickupAt);
  await ctx.profilePages.quote(userId, listed.id, { amount: 1600, currency: 'HKD' });
  await ctx.profilePages.passengerAccept(sent.code);

  const order = await ctx.orders.create(userId, {
    ...sampleOrder,
    pickupAt: listed.pickupAt,
    origin: listed.origin,
    destination: listed.destination,
    passengerContact: listed.passengerContact,
    passengerPrice: { amount: 1600, currency: 'HKD' },
    showPassengerPrice: true,
    roundTrip: { pickupAt: listed.returnPickupAt!, sameDriver: true, selfDriveLeg: null },
    selfDrive: true,
    bookingId: listed.id,
  });
  assert.equal(order.journey?.kind, 'ROUND_TRIP');
  assert.deepEqual(order.journey?.legs.map((leg) => [leg.origin, leg.selfDrive]), [['香港國際機場', true], ['深圳灣口岸', true]]);
  const after = await ctx.profilePages.passengerBooking(sent.code);
  assert.equal(after.status, 'ORDERED');
  const page = await ctx.orders.getForPassenger(after.confirmUrl!.split('/c/')[1]);
  assert.equal(page.roundTrip, true);
  assert.equal(page.price?.amount, 1600, 'one price for there and back');
});

test("a booking is its own page owner's: nobody else reads, answers or makes an order from it", async () => {
  const { userId, code } = await publishedPage();
  const stranger = await createDriver(ctx);
  const sent = await ctx.profilePages.createBooking(code, request(), '2.2.2.2');
  const [mine] = await ctx.profilePages.bookings(userId);

  assert.deepEqual(await ctx.profilePages.bookings(stranger), []);
  await rejectsWith(ctx.profilePages.booking(stranger, mine.id), 'BOOKING_NOT_FOUND');
  await rejectsWith(ctx.profilePages.quote(stranger, mine.id, { amount: 1, currency: 'HKD' }), 'BOOKING_NOT_FOUND');
  await rejectsWith(ctx.orders.create(stranger, { ...sampleOrder, bookingId: mine.id }), 'BOOKING_NOT_OPEN');
  assert.equal(await ctx.prisma.order.count(), 0, 'the refused order was not created');
  await rejectsWith(ctx.profilePages.passengerBooking('not-a-code'), 'BOOKING_NOT_FOUND');

  await ctx.profilePages.decline(userId, mine.id);
  assert.equal((await ctx.profilePages.passengerBooking(sent.code)).status, 'DECLINED');
  await rejectsWith(ctx.profilePages.passengerCancel(sent.code), 'BOOKING_NOT_OPEN');
});

test('booking limits from the admin: per address and per page; an unpublished page takes none', async () => {
  const { userId, code } = await publishedPage();
  await ctx.site.updateLimits({ bookingPerIpPerDay: 2, bookingPerPagePerDay: 3 }, 'test');
  await ctx.profilePages.createBooking(code, request(), '3.3.3.3');
  await ctx.profilePages.createBooking(code, request(), '3.3.3.3');
  await rejectsWith(ctx.profilePages.createBooking(code, request(), '3.3.3.3'), 'BOOKING_LIMIT');
  await ctx.profilePages.createBooking(code, request(), '4.4.4.4');
  await rejectsWith(ctx.profilePages.createBooking(code, request(), '5.5.5.5'), 'BOOKING_PAGE_FULL');

  await ctx.site.updateLimits({ bookingPerPagePerDay: 30 }, 'test');
  await rejectsWith(
    ctx.profilePages.createBooking(code, { ...request(), pickupAt: '2020-01-01T10:00:00+08:00' }, '5.5.5.5'),
    'BOOKING_IN_THE_PAST',
  );
  await ctx.profilePages.update(userId, { published: false });
  await rejectsWith(ctx.profilePages.createBooking(code, request(), '5.5.5.5'), 'PROFILE_PAGE_NOT_FOUND');
});
