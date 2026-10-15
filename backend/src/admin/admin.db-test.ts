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

async function superAdmin() {
  const { password } = await ctx.adminAuth.createAccount({ username: 'boss', displayName: 'Boss', role: 'SUPER_ADMIN' }, null);
  const { token } = await ctx.adminAuth.login({ username: 'boss', password }, '1.1.1.1', undefined);
  return (await ctx.adminAuth.resolveSession(token))!;
}

test('the one-time password signs in; the password is stored only as a hash', async () => {
  const { password } = await ctx.adminAuth.createAccount({ username: 'ops', displayName: 'Ops', role: 'OPERATOR' }, null);
  const stored = await ctx.prisma.administrator.findUniqueOrThrow({ where: { username: 'ops' } });
  assert.ok(stored.passwordHash.startsWith('scrypt$'));
  assert.ok(!stored.passwordHash.includes(password));
  const { token, admin } = await ctx.adminAuth.login({ username: 'ops', password }, undefined, undefined);
  assert.equal(admin.role, 'OPERATOR');
  assert.ok(await ctx.adminAuth.resolveSession(token));
});

test('five wrong passwords lock the username for a while', async () => {
  const { password } = await ctx.adminAuth.createAccount({ username: 'ops', displayName: 'Ops', role: 'OPERATOR' }, null);
  for (let i = 0; i < 5; i += 1) {
    await rejectsWith(ctx.adminAuth.login({ username: 'ops', password: 'wrong' }, '2.2.2.2', undefined), 'ADMIN_LOGIN_INVALID');
  }
  await rejectsWith(ctx.adminAuth.login({ username: 'ops', password }, '2.2.2.2', undefined), 'ADMIN_LOGIN_LOCKED');
});

test('disabling an account ends its sessions; you cannot disable yourself', async () => {
  const boss = await superAdmin();
  const { password } = await ctx.adminAuth.createAccount({ username: 'sales', displayName: 'Sales', role: 'SALES' }, boss.id);
  const { token } = await ctx.adminAuth.login({ username: 'sales', password }, undefined, undefined);
  const sales = await ctx.prisma.administrator.findUniqueOrThrow({ where: { username: 'sales' } });
  await ctx.adminAuth.setDisabled(sales.id, true, boss);
  assert.equal(await ctx.adminAuth.resolveSession(token), null);
  await rejectsWith(ctx.adminAuth.login({ username: 'sales', password }, undefined, undefined), 'ADMIN_LOGIN_INVALID');
  await rejectsWith(ctx.adminAuth.setDisabled(boss.id, true, boss), 'ADMIN_CANNOT_DISABLE_SELF');
});

test('a manual top-up changes credits and is written to the audit log', async () => {
  const boss = await superAdmin();
  const user = await createDriver(ctx);
  const summary = await ctx.adminData.changeCredits(user, { type: 'TOPUP', amount: 50, note: '轉數快 #1' }, boss);
  assert.deepEqual(summary.balance, { amount: 50, currency: 'HKD' });
  const log = await ctx.prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'credits.topup' } });
  assert.equal(log.targetId, user);
  await rejectsWith(ctx.adminData.changeCredits(user, { type: 'TOPUP', amount: -5, note: 'x' }, boss), 'TOPUP_MUST_BE_POSITIVE');
});

test('a plan gift lifts the quota until it is ended', async () => {
  const boss = await superAdmin();
  const user = await createDriver(ctx);
  const gifted = await ctx.adminData.createOverride(user, { planKey: 'company', reason: 'Master Travel 客戶' }, boss);
  assert.equal(gifted.entitlements.orderCreate.quota, null);
  const ended = await ctx.adminData.endOverride(user, gifted.overrides[0].id, boss);
  assert.equal(ended.entitlements.orderCreate.quota, 10);
  assert.equal(ended.overrides[0].active, false);
});

test('ending the free period from the admin takes effect immediately', async () => {
  const boss = await superAdmin();
  const catalogue = await ctx.adminData.createPolicy({ name: '上線全站免費期', planKey: 'company' }, boss);
  const user = await createDriver(ctx);
  assert.equal((await ctx.entitlements.check(user, 'order.create')).quota, null);
  await ctx.adminData.updatePolicy(catalogue.policies[0].id, { active: false }, boss);
  assert.equal((await ctx.entitlements.check(user, 'order.create')).quota, 10);
});

test('the admin sees the money marks, filters by them, and counts what is still open', async () => {
  const boss = await superAdmin();
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const done = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(done.code, driver);
  await ctx.orders.complete(driver, done.id);
  const own = await ctx.orders.create(dispatcher, { ...sampleOrder, selfDrive: true });
  await ctx.orders.complete(dispatcher, own.id);
  await ctx.orders.create(dispatcher, sampleOrder);

  const page = { page: 1, by: 'pickup' as const };
  let dashboard = await ctx.adminData.dashboard();
  assert.deepEqual(dashboard.money, { unpaidCompleted: 2, unsettledCompleted: 1 }, '這單我自己做 has nobody to settle with');
  assert.equal((await ctx.adminData.listOrders({ ...page, money: 'UNPAID' }, 'SUPER_ADMIN')).total, 2);
  const unsettled = await ctx.adminData.listOrders({ ...page, money: 'UNSETTLED' }, 'SUPER_ADMIN');
  assert.deepEqual(unsettled.items.map((item) => item.id), [done.id]);
  assert.equal(unsettled.items[0].selfDrive, false);

  await ctx.orders.setPayment(dispatcher, done.id, { paid: true });
  await ctx.orders.setSettlement(dispatcher, done.id, { settled: true });
  dashboard = await ctx.adminData.dashboard();
  assert.deepEqual(dashboard.money, { unpaidCompleted: 1, unsettledCompleted: 0 });
  const detail = await ctx.adminData.getOrder(done.id, boss);
  assert.ok(detail.payment.paidAt && detail.payment.settledAt);
  assert.deepEqual([detail.selfDrive, detail.fromBooking, detail.tripGroup], [false, false, null]);
  assert.equal((await ctx.adminData.getOrder(own.id, boss)).selfDrive, true);

  const user = await ctx.adminData.getUser(dispatcher);
  assert.equal(user.paymentMethods, 0);
  assert.equal(user.profilePage, null);
});

test('停用: a suspended user is signed out and cannot sign in until restored', async () => {
  const boss = await superAdmin();
  const user = await ctx.prisma.user.create({ data: { countryCode: '+852', phone: '61234567' } });
  await ctx.developmentLogin.update({ enabled: true, code: '246810' }, 'test');
  await ctx.auth.requestCode({ countryCode: '+852', phone: '61234567' }, undefined);
  const { token } = await ctx.auth.verifyCode({ countryCode: '+852', phone: '61234567', code: '246810' }, undefined);
  assert.ok(await ctx.auth.resolveSession(token));

  const suspended = await ctx.adminData.suspendUser(user.id, { reason: '重複發假單' }, boss);
  assert.ok(suspended.suspendedAt);
  assert.equal(suspended.suspendedReason, '重複發假單');
  assert.equal(await ctx.auth.resolveSession(token), null, 'signed out everywhere');
  await rejectsWith(ctx.adminData.suspendUser(user.id, { reason: 'again' }, boss), 'USER_ALREADY_SUSPENDED');
  await ctx.prisma.verificationCode.deleteMany();
  await ctx.auth.requestCode({ countryCode: '+852', phone: '61234567' }, undefined);
  await rejectsWith(ctx.auth.verifyCode({ countryCode: '+852', phone: '61234567', code: '246810' }, undefined), 'ACCOUNT_SUSPENDED');

  await ctx.adminData.restoreUser(user.id, boss);
  await rejectsWith(ctx.adminData.restoreUser(user.id, boss), 'USER_NOT_SUSPENDED');
  await ctx.prisma.verificationCode.deleteMany();
  await ctx.auth.requestCode({ countryCode: '+852', phone: '61234567' }, undefined);
  assert.ok((await ctx.auth.verifyCode({ countryCode: '+852', phone: '61234567', code: '246810' }, undefined)).token);
  const actions = (await ctx.prisma.adminAuditLog.findMany({ where: { targetId: user.id }, orderBy: { createdAt: 'asc' } })).map((row) => row.action);
  assert.deepEqual(actions, ['user.suspend', 'user.restore']);
});

test('staff cancel an order for its dispatcher and correct a driver\'s details, both on the record', async () => {
  const boss = await superAdmin();
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(order.code, driver);

  const cancelled = await ctx.adminData.cancelOrder(order.id, { reason: '乘客投訴，出單者失聯' }, boss);
  assert.equal(cancelled.status, 'CANCELLED');
  await rejectsWith(ctx.adminData.cancelOrder(order.id, { reason: 'again' }, boss), 'INVALID_ORDER_STATUS');
  const log = await ctx.prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'order.cancel' } });
  assert.deepEqual(log.detail, { reason: '乘客投訴，出單者失聯' });

  const profile = { name: '改名師傅', vehicleOwnership: 'HK' as const, plateType: 'SINGLE' as const, hkPlate: 'XY 999', vehicleType: '埃爾法', hidePlates: false };
  const saved = await ctx.adminData.saveUserProfile(driver, profile, boss);
  assert.equal(saved.profile?.name, '改名師傅');
  assert.equal(saved.profile?.hkPlate, 'XY 999');
  const change = await ctx.prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'user.profile.update' } });
  assert.ok((change.detail as { changed: string[] }).changed.includes('name'));
});

test('sales staff see orders but not passengers', async () => {
  const boss = await superAdmin();
  const dispatcher = await createDriver(ctx);
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  const sales = { ...boss, role: 'SALES' as const };
  assert.equal((await ctx.adminData.getOrder(order.id, sales)).passenger, null);
  assert.equal((await ctx.adminData.getOrder(order.id, boss)).passenger?.contact, sampleOrder.passengerContact);
  assert.equal(await ctx.prisma.adminAuditLog.count({ where: { action: 'order.viewPassenger' } }), 1);
});

test('a complaint about a 名片頁: found by its link, taken down until restored, a photo and a group removed', async () => {
  const boss = await superAdmin();
  const owner = await createDriver(ctx, '陳師傅');
  const page = await ctx.profilePages.update(owner, { published: true, intro: '十年經驗', whatsapp: '+852 6000 0000' });
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);
  const withPhoto = await ctx.profilePages.addPhoto(owner, jpeg);
  const photoId = withPhoto.photos[0].id;
  const png = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]).toString('base64')}`;
  const [group] = await ctx.groupInvites.create(owner, { platform: 'WECHAT', name: '', qrImage: png, showOnClaimPage: true });

  const found = await ctx.adminData.listUsers({ q: `https://md.test/p/${page.code}?from=wechat`, page: 1 });
  assert.deepEqual(found.items.map((item) => item.id), [owner], 'the page link finds its owner');

  const detail = await ctx.adminData.getUser(owner);
  assert.equal(detail.profilePage?.intro, '十年經驗');
  assert.equal(detail.profilePage?.url, `https://md.test/p/${page.code}`, 'the same link the driver shares');
  assert.deepEqual(detail.profilePage?.photoIds, [photoId]);
  assert.equal(detail.groupInvites[0].hasQr, true);
  assert.equal((await ctx.adminData.pagePhoto(owner, photoId)).mime, 'image/jpeg');
  assert.ok(await ctx.adminData.groupQr(owner, group.id));

  const blocked = await ctx.adminData.blockPage(owner, { reason: '照片含廣告' }, boss);
  assert.equal(blocked.profilePage?.published, false);
  assert.equal(blocked.profilePage?.blockedReason, '照片含廣告');
  await rejectsWith(ctx.profilePages.publicPage(page.code), 'PROFILE_PAGE_NOT_FOUND');
  await rejectsWith(ctx.profilePages.update(owner, { published: true }), 'PROFILE_PAGE_BLOCKED');
  assert.equal((await ctx.profilePages.mine(owner)).blocked?.reason, '照片含廣告', 'the owner is told why');
  await rejectsWith(ctx.adminData.blockPage(owner, { reason: '再一次' }, boss), 'PROFILE_PAGE_NOT_BLOCKABLE');

  const restored = await ctx.adminData.restorePage(owner, boss);
  assert.equal(restored.profilePage?.blockedAt, null);
  assert.equal(restored.profilePage?.published, false, 'the owner publishes it again themselves');
  await ctx.profilePages.update(owner, { published: true });

  const withoutPhoto = await ctx.adminData.removePagePhoto(owner, photoId, { reason: '不雅照片' }, boss);
  assert.deepEqual(withoutPhoto.profilePage?.photoIds, []);
  const withoutGroup = await ctx.adminData.removeGroupInvite(owner, group.id, { reason: '廣告群' }, boss);
  assert.deepEqual(withoutGroup.groupInvites, []);
  await rejectsWith(ctx.adminData.removeGroupInvite(owner, group.id, { reason: '廣告群' }, boss), 'GROUP_INVITE_NOT_FOUND');

  const log = await ctx.prisma.adminAuditLog.findMany({ where: { targetId: owner }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(log.map((entry) => entry.action), ['profile-page.block', 'profile-page.restore', 'profile-page.photo.remove', 'group-invite.remove']);
});

test("the user detail shows what the user turned off and their latest notifications", async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  await ctx.notifications.saveSettings(dispatcher, { off: ['BOOKINGS'] });
  const order = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(order.code, driver);
  const { notifications } = await ctx.adminData.getUser(dispatcher);
  assert.deepEqual(notifications.off, ['BOOKINGS']);
  assert.deepEqual(notifications.recent.map((item) => [item.kind, item.read]), [['ORDER_CLAIMED', false]]);
});

test('the order list narrows to some days, by trip date or by the day it was put out', async () => {
  const dispatcher = await createDriver(ctx);
  const early = await ctx.orders.create(dispatcher, sampleOrder);
  const late = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.prisma.order.update({ where: { id: early.id }, data: { pickupAt: new Date('2026-11-02T23:30:00+08:00'), createdAt: new Date('2026-10-01T10:00:00+08:00') } });
  await ctx.prisma.order.update({ where: { id: late.id }, data: { pickupAt: new Date('2026-11-03T00:30:00+08:00'), createdAt: new Date('2026-10-02T10:00:00+08:00') } });
  const list = (query: Partial<{ by: 'pickup' | 'created'; from: string; to: string }>) =>
    ctx.adminData.listOrders({ page: 1, by: 'pickup', ...query }, 'SUPER_ADMIN').then((result) => result.items.map((item) => item.id));

  assert.deepEqual(await list({ from: '2026-11-02', to: '2026-11-02' }), [early.id], 'Hong Kong days: 23:30 is still the 2nd');
  assert.deepEqual(await list({ from: '2026-11-03' }), [late.id]);
  assert.deepEqual(await list({ from: '2026-11-01', to: '2026-11-30' }), [late.id, early.id], 'latest trip first');
  assert.deepEqual(await list({ by: 'created', to: '2026-10-01' }), [early.id]);
});

test('the user list shows drivers, those without driver details, published pages or suspended accounts', async () => {
  const driver = await createDriver(ctx, '有資料');
  const bare = await ctx.prisma.user.create({ data: { countryCode: '+86', phone: '13800000001' } });
  const suspended = await createDriver(ctx, '被停用');
  await ctx.prisma.user.update({ where: { id: suspended }, data: { suspendedAt: new Date(), suspendedReason: '測試' } });
  await ctx.profilePages.update(driver, { published: true, intro: '' });
  const ids = (status?: 'DRIVER' | 'NO_PROFILE' | 'PAGE_PUBLISHED' | 'SUSPENDED') =>
    ctx.adminData.listUsers({ page: 1, status }).then((result) => result.items.map((item) => item.id).sort());

  assert.deepEqual(await ids('DRIVER'), [driver, suspended].sort());
  assert.deepEqual(await ids('NO_PROFILE'), [bare.id]);
  assert.deepEqual(await ids('PAGE_PUBLISHED'), [driver]);
  assert.deepEqual(await ids('SUSPENDED'), [suspended]);
  assert.deepEqual((await ctx.adminData.listUsers({ page: 1, q: bare.id })).items.map((item) => item.id), [bare.id], 'found by 帳戶 ID');
  assert.deepEqual((await ctx.adminData.listUsers({ page: 1, status: 'SUSPENDED' })).summary, { all: 3, drivers: 2, published: 1, suspended: 1 }, 'the cards count everyone');
});

test('one user\'s orders: those they put out, those they drove, or both; with a status and the money marks at once', async () => {
  const dispatcher = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const other = await createDriver(ctx);
  const theirs = await ctx.orders.create(dispatcher, sampleOrder);
  await ctx.orders.claim(theirs.code, driver);
  const driven = await ctx.orders.create(other, sampleOrder);
  await ctx.orders.claim(driven.code, dispatcher);
  await ctx.orders.complete(dispatcher, driven.id);
  await ctx.orders.create(other, sampleOrder);
  const ids = (query: { user: string; role?: 'dispatcher' | 'driver'; status?: 'COMPLETED'; money?: 'UNPAID' }) =>
    ctx.adminData.listOrders({ page: 1, by: 'pickup', ...query }, 'SUPER_ADMIN').then((result) => result.items.map((item) => item.id).sort());

  assert.deepEqual(await ids({ user: dispatcher, role: 'dispatcher' }), [theirs.id]);
  assert.deepEqual(await ids({ user: dispatcher, role: 'driver' }), [driven.id]);
  assert.deepEqual(await ids({ user: dispatcher }), [theirs.id, driven.id].sort());
  assert.deepEqual(await ids({ user: dispatcher, money: 'UNPAID', status: 'COMPLETED' }), [driven.id], 'a status and a money mark narrow together');
});

test('刪除用戶: refused while a trip with someone else is under way, then everything of the user goes', async () => {
  const boss = await superAdmin();
  const gone = await createDriver(ctx, '要刪的師傅');
  const driver = await createDriver(ctx, '接單師傅');
  const other = await createDriver(ctx, '別的出單者');

  // The user's own orders: one another driver has, one they drive themselves, one nobody took.
  const taken = await ctx.orders.create(gone, sampleOrder);
  await ctx.orders.claim(taken.code, driver);
  const own = await ctx.orders.create(gone, { ...sampleOrder, selfDrive: true });
  const open = await ctx.orders.create(gone, sampleOrder);
  // Another dispatcher's order the user took.
  const theirs = await ctx.orders.create(other, sampleOrder);
  await ctx.orders.claim(theirs.code, gone);

  const before = await ctx.adminData.userDeletion(gone);
  assert.deepEqual(new Set(before.blocking.map((order) => `${order.id}:${order.role}`)), new Set([`${taken.id}:DISPATCHED`, `${theirs.id}:CLAIMED`]));
  assert.deepEqual([before.dispatchedOrders, before.claimedOrdersKept], [3, 1]);
  await rejectsWith(ctx.adminData.deleteUser(gone, { reason: '用戶要求刪除' }, boss), 'USER_HAS_ACTIVE_ORDERS');
  assert.ok(await ctx.prisma.user.findUnique({ where: { id: gone } }), 'nothing deleted');

  await ctx.orders.complete(driver, taken.id);
  await ctx.orders.setSettlement(gone, taken.id, { settled: true });
  await ctx.orders.complete(gone, theirs.id);
  assert.equal((await ctx.adminData.userDeletion(gone)).blocking.length, 0);

  // What else the user has: a 名片頁 photo, a 客服 file, a sign-in code, another dispatcher's note on them.
  const page = await ctx.prisma.profilePage.create({ data: { userId: gone, code: 'DELME001' } });
  await ctx.mediaStorage.put(`profile/${page.id}/photo1.jpg`, Buffer.from('photo'), 'image/jpeg');
  await ctx.prisma.profilePhoto.create({ data: { id: 'photo1', pageId: page.id, storageKey: `profile/${page.id}/photo1.jpg`, mimeType: 'image/jpeg', sizeBytes: 5 } });
  const conversation = await ctx.prisma.supportConversation.create({ data: { userId: gone } });
  await ctx.mediaStorage.put(`support/${conversation.id}/media1.jpg`, Buffer.from('media'), 'image/jpeg');
  await ctx.prisma.supportMedia.create({
    data: { id: 'media1', conversationId: conversation.id, kind: 'IMAGE', mimeType: 'image/jpeg', sizeBytes: 5, storageKey: `support/${conversation.id}/media1.jpg`, checksum: 'x', expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { id: gone } });
  await ctx.prisma.verificationCode.create({ data: { countryCode: user.countryCode, phone: user.phone, codeHash: 'x', expiresAt: new Date() } });
  await ctx.prisma.driverNote.create({ data: { ownerId: other, driverId: gone, favorite: true, note: '準時' } });
  assert.ok(await ctx.prisma.notification.findFirst({ where: { userId: driver, orderId: taken.id } }), 'the driver was told about the user’s order');

  assert.deepEqual(await ctx.adminData.deleteUser(gone, { reason: '用戶要求刪除' }, boss, '1.1.1.1'), {
    deleted: true,
    dispatchedOrders: 3,
    claimedOrdersKept: 1,
  });

  assert.equal(await ctx.prisma.user.findUnique({ where: { id: gone } }), null);
  assert.equal(await ctx.prisma.order.count({ where: { id: { in: [taken.id, own.id, open.id] } } }), 0, 'the user’s orders are gone');
  assert.equal(await ctx.prisma.orderClaim.count({ where: { OR: [{ driverId: gone }, { orderId: taken.id }] } }), 0);
  assert.equal(await ctx.prisma.notification.count({ where: { orderId: { in: [taken.id, own.id, open.id] } } }), 0, 'nobody keeps a line about them');
  assert.equal(await ctx.prisma.profilePage.count({ where: { userId: gone } }), 0);
  assert.equal(await ctx.prisma.supportConversation.count({ where: { userId: gone } }), 0);
  assert.equal(await ctx.mediaStorage.read(`profile/${page.id}/photo1.jpg`), null, 'photo file removed');
  assert.equal(await ctx.mediaStorage.read(`support/${conversation.id}/media1.jpg`), null, '客服 file removed');
  assert.equal(await ctx.prisma.verificationCode.count({ where: { countryCode: user.countryCode, phone: user.phone } }), 0);
  assert.equal(await ctx.prisma.driverNote.count({ where: { driverId: gone } }), 0);

  // The other dispatcher's order stays theirs, finished, with no trace of the user but when it was taken.
  const kept = await ctx.prisma.order.findUniqueOrThrow({ where: { id: theirs.id } });
  assert.deepEqual([kept.status, kept.dispatcherId, kept.claimedById], ['COMPLETED', other, null]);
  assert.ok(kept.claimedAt);
  const detail = await ctx.adminData.getOrder(theirs.id, boss);
  assert.deepEqual([detail.driver, detail.driverDeleted, detail.claims.length], [null, true, 0]);
  const listed = await ctx.adminData.listOrders({ page: 1, by: 'pickup', user: other, role: 'dispatcher' }, 'SUPER_ADMIN');
  assert.deepEqual(listed.items.map((item) => [item.id, item.driverDeleted]), [[theirs.id, true]]);
  assert.ok(await ctx.prisma.user.findUnique({ where: { id: driver } }), 'the other users stay');

  const audit = await ctx.prisma.adminAuditLog.findFirstOrThrow({ where: { action: 'user.delete' } });
  assert.equal(audit.targetId, gone);
  assert.deepEqual(audit.detail, { phone: `${user.countryCode} ${user.phone}`, name: '要刪的師傅', dispatchedOrders: 3, claimedOrdersKept: 1, reason: '用戶要求刪除' });
  await rejectsWith(ctx.adminData.deleteUser(gone, { reason: 'again' }, boss), 'USER_NOT_FOUND');
});

test('刪除用戶: a 接駁 order goes with every leg; a leg another driver still has stops it', async () => {
  const boss = await superAdmin();
  const gone = await createDriver(ctx);
  const driver = await createDriver(ctx);
  const transfer = {
    ...sampleOrder,
    origin: '香港',
    destination: '廣州',
    transfer: { place: '深圳灣口岸', pickupAt: '2026-10-15T16:00:00+08:00', requiredPlates: ['MAINLAND' as const], selfDriveLeg: null },
  };
  const order = await ctx.orders.create(gone, transfer);
  const legs = order.journey!.legs;
  assert.equal(legs.length, 2);
  const second = await ctx.prisma.order.findUniqueOrThrow({ where: { journeyId_legIndex: { journeyId: order.id, legIndex: 2 } } });
  await ctx.orders.claim(second.code, driver);

  const blocked = await ctx.adminData.userDeletion(gone);
  assert.deepEqual(blocked.blocking.map((leg) => [leg.id, leg.legIndex]), [[second.id, 2]]);
  await rejectsWith(ctx.adminData.deleteUser(gone, { reason: '測試' }, boss), 'USER_HAS_ACTIVE_ORDERS');

  await ctx.orders.complete(driver, second.id);
  const result = await ctx.adminData.deleteUser(gone, { reason: '測試' }, boss);
  assert.equal(result.dispatchedOrders, 2);
  assert.equal(await ctx.prisma.order.count({ where: { OR: [{ id: order.id }, { journeyId: order.id }] } }), 0);
});
