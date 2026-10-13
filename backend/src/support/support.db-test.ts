import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { SUPPORT_IMAGE_MAX_BYTES } from '@masterdriver/shared';
import { UnavailableMediaStorage } from '../storage/media-storage';
import { readLimits } from '../common/limits';
import { SUPPORT_LIMITS, SupportService, type Participant } from './support.service';
import { createDriver, rejectsWith, setupDatabase, type TestContext } from '../test/database';

let ctx: TestContext;

before(async () => {
  ctx = await setupDatabase();
});
beforeEach(async () => {
  await ctx.reset();
});
after(async () => {
  await ctx?.prisma.$disconnect();
});

let messageSeed = 0;
const cid = () => `client-msg-${(messageSeed += 1)}`;
const text = (value: string) => ({ text: value, clientMessageId: cid() });
const jpeg = (size = 64) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size, 1)]);
const mp4 = Buffer.concat([Buffer.from('\0\0\0\x18ftypisom', 'latin1'), Buffer.alloc(64, 2)]);

async function staff() {
  const { password } = await ctx.adminAuth.createAccount({ username: 'ops', displayName: '營運小陳', role: 'OPERATOR' }, null);
  const { token } = await ctx.adminAuth.login({ username: 'ops', password }, undefined, undefined);
  return (await ctx.adminAuth.resolveSession(token))!;
}

const asUser = (userId: string): Participant => ({ type: 'USER', userId });
async function asGuest(ip = '9.9.9.9') {
  const { token } = await ctx.support.openGuest(ip);
  return { token, guest: (await ctx.support.guestParticipant(token))! };
}

test('a user writes, staff sees it waiting and replies, the user sees the reply as unread until opened', async () => {
  const user = asUser(await createDriver(ctx, '陳師傅'));
  const admin = await staff();
  assert.deepEqual((await ctx.support.thread(user, {})).messages, []);

  await ctx.support.sendText(user, text('點數怎麼充值？'));
  const inbox = await ctx.support.list({ page: 1, filter: 'waiting', q: undefined });
  assert.equal(inbox.waiting, 1);
  assert.equal(inbox.items[0].name, '陳師傅');
  assert.equal(inbox.items[0].preview, '點數怎麼充值？');

  const reply = await ctx.support.staffSendText(inbox.items[0].id, admin, text('請用轉數快，備註手機號碼'), '1.1.1.1');
  assert.equal(reply.staffName, '營運小陳');
  assert.equal(await ctx.support.waitingCount(), 0);
  assert.deepEqual(await ctx.support.unread(user), { count: 1 });

  const thread = await ctx.support.thread(user, {});
  assert.deepEqual(thread.messages.map((message) => [message.fromStaff, message.text]), [
    [false, '點數怎麼充值？'],
    [true, '請用轉數快，備註手機號碼'],
  ]);
  assert.equal('staffName' in thread.messages[1], false, 'users see 客服, not which administrator');
  assert.deepEqual(await ctx.support.unread(user), { count: 0 });

  const audit = await ctx.prisma.adminAuditLog.findMany({ where: { action: 'support.reply' } });
  assert.equal(audit.length, 1);
  assert.deepEqual(audit[0].detail, { kind: 'TEXT' }, 'the audit trail never holds what was said');
});

test('a message sent again with the same client id is not posted twice', async () => {
  const user = asUser(await createDriver(ctx));
  const body = text('重複送出');
  const [first, second] = await Promise.all([ctx.support.sendText(user, body), ctx.support.sendText(user, body)]);
  assert.equal(first.id, second.id);
  assert.equal(await ctx.prisma.supportMessage.count(), 1);

  const picture = { bytes: jpeg(), id: cid() };
  const sent = await Promise.all([ctx.support.sendMedia(user, picture.bytes, picture.id), ctx.support.sendMedia(user, picture.bytes, picture.id)]);
  assert.equal(sent[0].media?.id, sent[1].media?.id);
  const stored = await ctx.prisma.supportMedia.findMany();
  assert.equal(stored.length, 1, 'one file record');
});

test('polling by seq returns only newer messages; older ones come a page at a time', async () => {
  const user = asUser(await createDriver(ctx));
  const now = Date.now();
  for (let i = 1; i <= 55; i += 1) await ctx.support.sendText(user, text(`第${i}則`), new Date(now - (60 - i) * 60_000 * 4));
  const latest = await ctx.support.thread(user, {});
  assert.equal(latest.messages.length, 50);
  assert.equal(latest.hasEarlier, true);
  assert.equal(latest.messages.at(-1)?.text, '第55則');
  const earlier = await ctx.support.thread(user, { before: latest.messages[0].seq });
  assert.deepEqual([earlier.messages.length, earlier.hasEarlier, earlier.messages[0].text], [5, false, '第1則']);
  const newer = await ctx.support.thread(user, { after: latest.messages.at(-1)!.seq });
  assert.deepEqual(newer.messages, []);
});

test('pictures and videos: stored privately, readable by the sender and staff, never by another user or guest', async () => {
  const owner = asUser(await createDriver(ctx));
  const other = asUser(await createDriver(ctx));
  const { guest } = await asGuest();
  const admin = await staff();

  const picture = await ctx.support.sendMedia(owner, jpeg(), cid());
  const video = await ctx.support.sendMedia(owner, mp4, cid());
  assert.deepEqual([picture.kind, picture.media?.mime, video.kind, video.media?.mime], ['IMAGE', 'image/jpeg', 'VIDEO', 'video/mp4']);

  const record = await ctx.prisma.supportMedia.findUniqueOrThrow({ where: { id: picture.media!.id } });
  assert.match(record.storageKey, /^support\/[a-z0-9]+\/[A-Za-z0-9]{24}\.jpg$/);
  assert.equal(record.checksum.length, 64);
  assert.equal(Math.round((record.expiresAt.getTime() - record.createdAt.getTime()) / 86_400_000), SUPPORT_LIMITS.mediaRetentionDays);
  assert.ok((await ctx.mediaStorage.read(record.storageKey))?.equals(jpeg()));

  assert.ok((await ctx.support.media(owner, picture.media!.id)).bytes.equals(jpeg()));
  assert.equal((await ctx.support.staffMedia(video.media!.id)).mime, 'video/mp4');
  await rejectsWith(ctx.support.media(other, picture.media!.id), 'SUPPORT_MEDIA_NOT_FOUND');
  await ctx.support.sendText(other, text('我也有對話'));
  await rejectsWith(ctx.support.media(other, picture.media!.id), 'SUPPORT_MEDIA_NOT_FOUND');
  await rejectsWith(ctx.support.media(guest, picture.media!.id), 'SUPPORT_MEDIA_NOT_FOUND');

  const conversation = (await ctx.support.list({ page: 1, filter: 'all', q: undefined })).items.find((item) => item.preview === '［影片］')!;
  const fromStaff = await ctx.support.staffSendMedia(conversation.id, admin, jpeg(128), cid());
  assert.ok((await ctx.support.media(owner, fromStaff.media!.id)).bytes.equals(jpeg(128)));
});

test('what is not a picture or video, or is too large, is refused and nothing is stored', async () => {
  const user = asUser(await createDriver(ctx));
  await rejectsWith(ctx.support.sendMedia(user, Buffer.from('<!doctype html><script>alert(1)</script>'), cid()), 'SUPPORT_MEDIA_TYPE');
  await rejectsWith(ctx.support.sendMedia(user, jpeg(SUPPORT_IMAGE_MAX_BYTES), cid()), 'SUPPORT_MEDIA_TOO_LARGE');
  assert.equal(await ctx.prisma.supportMedia.count(), 0);
  assert.equal(await ctx.prisma.supportMessage.count(), 0);
});

test('without storage, pictures are refused and text still works', async () => {
  const support = new SupportService(ctx.prisma, new UnavailableMediaStorage(), ctx.audit, ctx.notifications);
  const user = asUser(await createDriver(ctx));
  await rejectsWith(support.sendMedia(user, jpeg(), cid()), 'SUPPORT_MEDIA_UNAVAILABLE');
  await support.sendText(user, text('只有文字'));
  assert.deepEqual((await support.thread(user, {})).uploads, { images: false, videos: false });
});

test('a guest talks through a token; guests send pictures but no video, and only so many', async () => {
  const { token, guest } = await asGuest();
  assert.equal(await ctx.support.guestParticipant('not-a-token'), null);
  const stored = await ctx.prisma.supportConversation.findFirstOrThrow();
  assert.ok(stored.guestTokenHash && stored.guestTokenHash !== token, 'only the hash is kept');

  await ctx.support.sendText(guest, text('登入收不到驗證碼'));
  const inbox = await ctx.support.list({ page: 1, filter: 'waiting', q: undefined });
  assert.deepEqual([inbox.items[0].participant, inbox.items[0].phone], ['GUEST', null]);
  assert.deepEqual((await ctx.support.thread(guest, {})).uploads, { images: true, videos: false });

  await rejectsWith(ctx.support.sendMedia(guest, mp4, cid()), 'SUPPORT_VIDEO_SIGN_IN');
  const day = Date.now();
  const { supportGuestMediaPerDay } = await readLimits(ctx.prisma);
  for (let i = 0; i < supportGuestMediaPerDay; i += 1) {
    await ctx.support.sendMedia(guest, jpeg(), cid(), new Date(day - (i + 2) * 5 * 60_000));
  }
  await rejectsWith(ctx.support.sendMedia(guest, jpeg(), cid()), 'SUPPORT_MEDIA_LIMIT');

  const another = await asGuest();
  assert.deepEqual((await ctx.support.thread(another.guest, {})).messages, [], 'a guest never sees another guest');
});

test('one address opens only a few guest conversations a day, and nobody floods a conversation', async () => {
  const limits = await readLimits(ctx.prisma);
  for (let i = 0; i < limits.supportGuestConversationsPerIpPerDay; i += 1) await ctx.support.openGuest('7.7.7.7');
  await rejectsWith(ctx.support.openGuest('7.7.7.7'), 'SUPPORT_GUEST_LIMIT');
  await ctx.support.openGuest('8.8.8.8');

  const user = asUser(await createDriver(ctx));
  for (let i = 0; i < limits.supportMessagesPerMinute; i += 1) await ctx.support.sendText(user, text(`${i}`));
  await rejectsWith(ctx.support.sendText(user, text('太快')), 'SUPPORT_TOO_FAST');
});

test('the limits set in the admin apply at once, and zero switches a thing off', async () => {
  const defaults = await ctx.site.limits();
  assert.deepEqual(
    [defaults.supportGuestMediaPerDay, defaults.supportUserMediaPerDay, defaults.supportMessagesPerMinute, defaults.supportGuestConversationsPerIpPerDay],
    [10, 30, 20, 5],
  );

  await ctx.site.updateLimits({ supportMessagesPerMinute: 2, supportUserMediaPerDay: 1, supportGuestConversationsPerIpPerDay: 1 }, 'test');
  const user = asUser(await createDriver(ctx));
  await ctx.support.sendMedia(user, jpeg(), cid());
  await rejectsWith(ctx.support.sendMedia(user, jpeg(), cid()), 'SUPPORT_MEDIA_LIMIT');
  await ctx.support.sendText(user, text('第二則'));
  await rejectsWith(ctx.support.sendText(user, text('第三則')), 'SUPPORT_TOO_FAST');
  await ctx.support.openGuest('6.6.6.6');
  await rejectsWith(ctx.support.openGuest('6.6.6.6'), 'SUPPORT_GUEST_LIMIT');

  await ctx.site.updateLimits({ supportMessagesPerMinute: 20, supportGuestMediaPerDay: 0, supportGuestConversationsPerIpPerDay: 0 }, 'test');
  await ctx.support.sendText(user, text('放寬後可以再傳'));
  await rejectsWith(ctx.support.openGuest('5.5.5.5'), 'SUPPORT_GUEST_LIMIT');
  const guest = (await ctx.support.guestParticipant((await ctx.prisma.supportConversation.findFirstOrThrow({ where: { guestIp: '6.6.6.6' } })).guestTokenHash ?? ''));
  assert.equal(guest, null, 'a hash is not a token');
  assert.equal((await ctx.site.limits()).updatedBy, 'test');
});

test('主動聯繫: staff opens the conversation of an existing user, and only of one that exists', async () => {
  const userId = await createDriver(ctx, '李師傅');
  const admin = await staff();
  const { id } = await ctx.support.openForUser(userId, admin);
  assert.equal((await ctx.support.openForUser(userId, admin)).id, id);
  await ctx.support.staffSendText(id, admin, text('你好，這裡是客服'));
  assert.deepEqual(await ctx.support.unread(asUser(userId)), { count: 1 });
  assert.equal((await ctx.support.staffThread(id, {})).conversation.name, '李師傅');
  await rejectsWith(ctx.support.openForUser('nobody', admin), 'USER_NOT_FOUND');
  await rejectsWith(ctx.support.staffSendText('nothing', admin, text('x')), 'SUPPORT_CONVERSATION_NOT_FOUND');
});

test('expired files leave storage; the message stays and says the file is gone', async () => {
  const user = asUser(await createDriver(ctx));
  const longAgo = new Date(Date.now() - (SUPPORT_LIMITS.mediaRetentionDays + 1) * 86_400_000);
  const old = await ctx.support.sendMedia(user, jpeg(), cid(), longAgo);
  const fresh = await ctx.support.sendMedia(user, jpeg(32), cid());
  const key = (await ctx.prisma.supportMedia.findUniqueOrThrow({ where: { id: old.media!.id } })).storageKey;

  assert.deepEqual(await ctx.support.purgeExpiredMedia(), { removed: 1 });
  assert.deepEqual(await ctx.support.purgeExpiredMedia(), { removed: 0 });
  assert.equal(await ctx.mediaStorage.read(key), null);
  await rejectsWith(ctx.support.media(user, old.media!.id), 'SUPPORT_MEDIA_NOT_FOUND');
  const thread = await ctx.support.thread(user, {});
  assert.deepEqual(thread.messages.map((message) => message.media?.available), [false, true]);
  assert.ok(await ctx.support.media(user, fresh.media!.id));
});

test('the dashboard counts conversations waiting for a reply', async () => {
  const user = asUser(await createDriver(ctx));
  await ctx.support.sendText(user, text('有人嗎'));
  assert.equal((await ctx.adminData.dashboard()).supportWaiting, 1);
});
