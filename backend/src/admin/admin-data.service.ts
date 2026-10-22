import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminCreditChange,
  AdminReason,
  DriverProfileInput,
  AdminOrderQuery,
  AdminOverrideCreate,
  AdminPlanFeature,
  AdminPolicyCreate,
  AdminPolicyUpdate,
  AdminRole,
  AdminUserQuery,
} from '@masterdriver/shared';
import type { Prisma } from '../../generated/prisma';
import { CommissionService, COMMISSION_EXEMPT_FEATURE } from '../billing/commission.service';
import { CreditsService } from '../billing/credits.service';
import { apiError } from '../common/errors';
import { EntitlementsService, FEATURES } from '../entitlements/entitlements.service';
import { driverPriceOf, isSelfDriven, passengerPriceOf, marginOf, orderInclude } from '../orders/order-view';
import { GroupInvitesService } from '../groups/group-invites.service';
import { OrdersService } from '../orders/orders.service';
import { DealsService } from '../deals/deals.service';
import { ProfilePagesService } from '../profile-pages/profile-pages.service';
import { PrismaService } from '../prisma.service';
import { MEDIA_STORAGE, type MediaStorage } from '../storage/media-storage';
import type { AdminUser } from './admin-auth.service';
import { AuditService, PAGE_SIZE } from './audit.service';

const DAY_MS = 24 * 60 * 60 * 1000;
/** Sales can see who is active but not passengers' contact details. */
const canSeePassengers = (role: AdminRole) => role !== 'SALES';

/** A trip with a driver (or done) whose fare the dispatcher has not marked as received. */
const UNPAID: Prisma.OrderWhereInput = { status: { in: ['ASSIGNED', 'COMPLETED'] }, paidAt: null };

/** Start of today in Hong Kong (UTC+8), as a UTC instant. */
function startOfHongKongDay(now: Date) {
  const shifted = now.getTime() + 8 * 60 * 60 * 1000;
  return new Date(shifted - (shifted % DAY_MS) - 8 * 60 * 60 * 1000);
}

@Injectable()
export class AdminDataService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(CreditsService) private readonly credits: CreditsService,
    @Inject(CommissionService) private readonly commission: CommissionService,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
    @Inject(OrdersService) private readonly orders: OrdersService,
    @Inject(ProfilePagesService) private readonly profilePages: ProfilePagesService,
    @Inject(DealsService) private readonly deals: DealsService,
    @Inject(GroupInvitesService) private readonly groupInvites: GroupInvitesService,
    @Inject(MEDIA_STORAGE) private readonly storage: MediaStorage,
  ) {}

  // -------------------------------------------------------------- dashboard

  async dashboard(now = new Date()) {
    const today = startOfHongKongDay(now);
    // 近 7 天: today and the six Hong Kong days before it, so the order list can show the same orders by date.
    const weekAgo = new Date(today.getTime() - 6 * DAY_MS);
    const [users, newUsers, ordersToday, ordersWeek, byStatus, claimsWeek, dispatchers, credits, fee, devLogin, freePeriods, supportWaiting, supportUnread, unpaid, unsettled, bookingsWeek, bookingsPending] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.user.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.order.count({ where: { createdAt: { gte: today } } }),
        this.prisma.order.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.order.groupBy({ by: ['status'], where: { createdAt: { gte: weekAgo } }, _count: true }),
        this.prisma.orderClaim.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.order.groupBy({ by: ['dispatcherId'], where: { createdAt: { gte: weekAgo } } }),
        this.prisma.creditAccount.aggregate({ _sum: { balanceMinor: true } }),
        this.commission.status(),
        this.prisma.phoneLoginDevelopmentSetting.findUnique({ where: { id: 'default' }, select: { enabled: true } }),
        this.prisma.billingPolicy.findMany({
          where: { active: true, planKey: { not: null }, startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          select: { name: true, endsAt: true },
        }),
        this.prisma.supportConversation.count({ where: { waiting: true } }),
        this.prisma.supportConversation.count({ where: { unreadByStaff: { gt: 0 } } }),
        this.prisma.order.count({ where: { ...UNPAID, status: 'COMPLETED' } }),
        this.prisma.order.count({ where: this.unsettled() }),
        this.prisma.bookingRequest.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.bookingRequest.count({ where: { status: 'PENDING' } }),
      ]);
    return {
      /** The first day of 近 7 天, for links to the order list. */
      weekFrom: new Date(weekAgo.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
      users: { total: users, newThisWeek: newUsers },
      orders: {
        today: ordersToday,
        thisWeek: ordersWeek,
        thisWeekByStatus: Object.fromEntries(byStatus.map((row) => [row.status, row._count])),
      },
      claimsThisWeek: claimsWeek,
      activeDispatchersThisWeek: dispatchers.length,
      creditsOutstanding: (credits._sum.balanceMinor ?? 0) / 100,
      serviceFee: fee,
      developmentLoginEnabled: devLogin?.enabled ?? false,
      /** 客服 conversations whose last message has no reply yet. */
      supportWaiting,
      /** Of those and any others, how many have a message no staff member has opened yet. */
      supportUnread,
      /** Finished trips still waiting on the dispatcher's own marks; the platform handles no money. */
      money: { unpaidCompleted: unpaid, unsettledCompleted: unsettled },
      /** 名片頁 bookings: sent in the last 7 days, and still waiting for the driver's answer. */
      bookings: { thisWeek: bookingsWeek, pending: bookingsPending },
      freePeriods: freePeriods.map((policy) => ({ name: policy.name, endsAt: policy.endsAt?.toISOString() ?? null })),
    };
  }

  /** A finished trip driven by someone else whose account the dispatcher has not marked as settled. */
  private unsettled(): Prisma.OrderWhereInput {
    return { status: 'COMPLETED', settledAt: null, NOT: { claimedById: { equals: this.prisma.order.fields.dispatcherId } } };
  }

  // ------------------------------------------------------------------ users

  async listUsers(query: AdminUserQuery) {
    // A complaint usually comes with the 名片頁 link (…/p/{code}): it finds the page's owner too.
    const pageCode = query.q?.match(/\/p\/([A-Za-z0-9]{8})\b/)?.[1] ?? query.q;
    const STATUS: Record<NonNullable<AdminUserQuery['status']>, Prisma.UserWhereInput> = {
      DRIVER: { profile: { isNot: null } },
      NO_PROFILE: { profile: { is: null } },
      PAGE_PUBLISHED: { profilePage: { published: true, blockedAt: null } },
      SUSPENDED: { suspendedAt: { not: null } },
    };
    const where: Prisma.UserWhereInput = {
      ...(query.status ? STATUS[query.status] : {}),
      ...(query.q
        ? {
            OR: [
              { phone: { contains: query.q } },
              { profile: { name: { contains: query.q, mode: 'insensitive' } } },
              { profilePage: { code: pageCode } },
              // The 帳戶 ID that 客服 and the audit log show.
              { id: query.q },
            ],
          }
        : {}),
    };
    const [total, all, drivers, published, suspended, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.count(),
      this.prisma.user.count({ where: STATUS.DRIVER }),
      this.prisma.user.count({ where: STATUS.PAGE_PUBLISHED }),
      this.prisma.user.count({ where: STATUS.SUSPENDED }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          profile: { select: { name: true, plateType: true, vehicleType: true, hkPlate: true, macauPlate: true, mainlandPlate: true } },
          profilePage: { select: { published: true } },
          creditAccount: { select: { balanceMinor: true } },
          _count: { select: { dispatchedOrders: true, claimedOrders: true } },
        },
      }),
    ]);
    return {
      total,
      /** Counts over everyone, whatever the search: the cards above the list, each a filter. */
      summary: { all, drivers, published, suspended },
      page: query.page,
      pageSize: PAGE_SIZE,
      items: users.map((user) => ({
        id: user.id,
        phone: `${user.countryCode} ${user.phone}`,
        name: user.profile?.name ?? null,
        plates: [user.profile?.hkPlate, user.profile?.macauPlate, user.profile?.mainlandPlate].filter(Boolean),
        plateType: user.profile?.plateType ?? null,
        vehicleType: user.profile?.vehicleType ?? null,
        pagePublished: user.profilePage?.published ?? false,
        dispatched: user._count.dispatchedOrders,
        claimed: user._count.claimedOrders,
        credits: (user.creditAccount?.balanceMinor ?? 0) / 100,
        suspended: Boolean(user.suspendedAt),
        createdAt: user.createdAt.toISOString(),
      })),
    };
  }

  async getUser(id: string, now = new Date()) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: {
        profile: true,
        subscriptions: { orderBy: { createdAt: 'desc' } },
        entitlementOverrides: { orderBy: { createdAt: 'desc' } },
        usages: { orderBy: { period: 'desc' }, take: 12 },
        profilePage: {
          include: { photos: { orderBy: { createdAt: 'asc' }, select: { id: true } }, _count: { select: { bookings: true } } },
        },
        groupInvites: { orderBy: { createdAt: 'asc' } },
        notifications: { orderBy: { createdAt: 'desc' }, take: 20 },
        _count: { select: { dispatchedOrders: true, claimedOrders: true, paymentMethods: true } },
      },
    });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    const [credits, orderCreate, commissionExempt, serviceFee] = await Promise.all([
      this.credits.summary(id),
      this.entitlements.check(id, FEATURES.orderCreate, now),
      this.entitlements.check(id, COMMISSION_EXEMPT_FEATURE, now),
      this.commission.forUser(id, now),
    ]);
    const iso = (date: Date | null) => date?.toISOString() ?? null;
    return {
      id: user.id,
      phone: `${user.countryCode} ${user.phone}`,
      locale: user.locale,
      createdAt: user.createdAt.toISOString(),
      /** 停用: when staff stopped the account, and why. */
      suspendedAt: iso(user.suspendedAt),
      suspendedReason: user.suspendedReason,
      profile: user.profile,
      counts: { dispatched: user._count.dispatchedOrders, claimed: user._count.claimedOrders },
      /**
       * 名片頁 as the driver set it up, with what it says, for looking into a complaint; null when
       * they never opened the editor. Photos are read through the admin API.
       */
      profilePage: user.profilePage && {
        code: user.profilePage.code,
        url: this.profilePages.pageUrl(user.profilePage.code),
        published: user.profilePage.published,
        searchable: user.profilePage.searchable,
        blockedAt: iso(user.profilePage.blockedAt),
        blockedReason: user.profilePage.blockedReason,
        intro: user.profilePage.intro,
        routes: user.profilePage.routes,
        languages: user.profilePage.languages,
        regions: user.profilePage.regions,
        wechatId: user.profilePage.wechatId || null,
        whatsapp: user.profilePage.whatsapp || null,
        photos: user.profilePage.photos.length,
        photoIds: user.profilePage.photos.map((photo) => photo.id),
        bookings: user.profilePage._count.bookings,
      },
      /** 派單群 the driver shows on their claim pages: WhatsApp links as they are, WeChat QR images through the admin API. */
      groupInvites: user.groupInvites.map((invite) => ({
        id: invite.id,
        platform: invite.platform,
        name: invite.name,
        inviteUrl: invite.inviteUrl,
        hasQr: invite.qrImage !== null,
        expiresAt: iso(invite.expiresAt),
        showOnClaimPage: invite.showOnClaimPage,
        createdAt: invite.createdAt.toISOString(),
      })),
      /** 通知: what the user turned off, and their latest lines, for 「我沒收到通知」. */
      notifications: {
        off: user.notificationsOff,
        recent: user.notifications.map((item) => ({
          kind: item.kind,
          summary: item.summary,
          read: item.readAt !== null,
          createdAt: item.createdAt.toISOString(),
        })),
      },
      /** 收款方式: how many the user has set up; the accounts and QR codes themselves stay with the user. */
      paymentMethods: user._count.paymentMethods,
      credits,
      serviceFee,
      entitlements: { orderCreate, commissionExempt },
      usage: user.usages.map((usage) => ({ featureKey: usage.featureKey, period: usage.period, used: usage.used })),
      subscriptions: user.subscriptions.map((s) => ({
        id: s.id,
        planKey: s.planKey,
        source: s.source,
        status: s.status,
        startsAt: s.startsAt.toISOString(),
        endsAt: iso(s.endsAt),
      })),
      overrides: user.entitlementOverrides.map((o) => ({
        id: o.id,
        planKey: o.planKey,
        featureKey: o.featureKey,
        enabled: o.enabled,
        quota: o.quota,
        startsAt: o.startsAt.toISOString(),
        endsAt: iso(o.endsAt),
        reason: o.reason,
        active: o.startsAt <= now && (!o.endsAt || o.endsAt > now),
      })),
    };
  }

  async changeCredits(userId: string, input: AdminCreditChange, admin: AdminUser, ip?: string) {
    await this.ensureUser(userId);
    const amountMinor = Math.round(input.amount * 100);
    if (input.type === 'TOPUP' && amountMinor < 0) {
      throw apiError(HttpStatus.BAD_REQUEST, 'TOPUP_MUST_BE_POSITIVE', 'A top-up must be positive');
    }
    const balance = await this.credits.credit(userId, amountMinor, {
      type: input.type,
      source: input.type === 'TOPUP' ? 'MANUAL' : undefined,
      note: input.note,
      createdBy: `admin:${admin.username}`,
    });
    await this.audit.log({
      adminId: admin.id,
      action: `credits.${input.type.toLowerCase()}`,
      targetType: 'user',
      targetId: userId,
      detail: { amount: input.amount, note: input.note, balanceAfter: balance / 100 },
      ip,
    });
    return this.credits.summary(userId);
  }

  async createOverride(userId: string, input: AdminOverrideCreate, admin: AdminUser, ip?: string) {
    await this.ensureUser(userId);
    if (input.planKey && !(await this.prisma.plan.findUnique({ where: { key: input.planKey } }))) {
      throw apiError(HttpStatus.BAD_REQUEST, 'PLAN_NOT_FOUND', 'Unknown plan');
    }
    if (input.featureKey && !(await this.prisma.feature.findUnique({ where: { key: input.featureKey } }))) {
      throw apiError(HttpStatus.BAD_REQUEST, 'FEATURE_NOT_FOUND', 'Unknown feature');
    }
    const override = await this.prisma.entitlementOverride.create({
      data: {
        userId,
        planKey: input.planKey,
        featureKey: input.featureKey,
        enabled: input.enabled,
        quota: input.quota ?? null,
        startsAt: input.startsAt ?? new Date(),
        endsAt: input.endsAt,
        reason: input.reason,
      },
    });
    await this.audit.log({
      adminId: admin.id,
      action: 'entitlement.override.create',
      targetType: 'user',
      targetId: userId,
      detail: { overrideId: override.id, planKey: input.planKey, featureKey: input.featureKey, reason: input.reason },
      ip,
    });
    return this.getUser(userId);
  }

  /** Ends a grant now instead of deleting it, so its history stays. */
  async endOverride(userId: string, overrideId: string, admin: AdminUser, ip?: string) {
    const ended = await this.prisma.entitlementOverride.updateMany({
      where: { id: overrideId, userId },
      data: { endsAt: new Date() },
    });
    if (ended.count === 0) throw apiError(HttpStatus.NOT_FOUND, 'OVERRIDE_NOT_FOUND', 'Grant not found');
    await this.audit.log({ adminId: admin.id, action: 'entitlement.override.end', targetType: 'user', targetId: userId, detail: { overrideId }, ip });
    return this.getUser(userId);
  }

  /**
   * 停用: stops an account for abuse. The user is signed out everywhere and cannot sign in
   * again until restored. Their orders are left as they are; cancel those one by one if needed.
   */
  async suspendUser(id: string, input: AdminReason, admin: AdminUser, ip?: string, now = new Date()) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { suspendedAt: true } });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    if (user.suspendedAt) throw apiError(HttpStatus.CONFLICT, 'USER_ALREADY_SUSPENDED', 'The account is already suspended');
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { suspendedAt: now, suspendedReason: input.reason } });
      await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: now } });
      await this.audit.log({ adminId: admin.id, action: 'user.suspend', targetType: 'user', targetId: id, detail: { reason: input.reason }, ip }, tx);
    });
    return this.getUser(id, now);
  }

  async restoreUser(id: string, admin: AdminUser, ip?: string, now = new Date()) {
    const restored = await this.prisma.user.updateMany({ where: { id, suspendedAt: { not: null } }, data: { suspendedAt: null, suspendedReason: null } });
    if (restored.count === 0) throw apiError(HttpStatus.CONFLICT, 'USER_NOT_SUSPENDED', 'The account is not suspended');
    await this.audit.log({ adminId: admin.id, action: 'user.restore', targetType: 'user', targetId: id, ip });
    return this.getUser(id, now);
  }

  /**
   * 刪除用戶, before it is done: what would go, and the trips under way with someone else that
   * stop it (an order the user put out that another driver has, or another dispatcher's order
   * the user has and has not finished). Those are dealt with first, for example 代為取消.
   */
  async userDeletion(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    return this.deletionOf(this.prisma, id);
  }

  /**
   * 刪除用戶 (超級管理員 only), for good. Everything of the user goes: the orders they put out,
   * with every leg, claim and 行程群 and the notifications others got about them; their 名片頁
   * and its bookings and photos, 客服 conversation and its files, credits, 收款方式, 派單群,
   * other dispatchers' notes on them, sessions, sign-in codes and SMS records. Another
   * dispatcher's order they took stays with that dispatcher, without them: the order keeps when
   * it was taken, so it reads 司機已刪除. Refused while a trip with someone else is under way.
   * The files go first, as with 刪除對話; the audit trail keeps who deleted which number and how
   * many orders, nothing else of the user.
   */
  async deleteUser(id: string, input: AdminReason, admin: AdminUser, ip?: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        countryCode: true,
        phone: true,
        profile: { select: { name: true } },
        profilePage: { select: { photos: { select: { storageKey: true } } } },
        supportConversation: { select: { media: { select: { storageKey: true } } } },
      },
    });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    const before = await this.deletionOf(this.prisma, id);
    if (before.blocking.length > 0) throw this.activeOrders(before.blocking);

    const files = [...(user.profilePage?.photos ?? []), ...(user.supportConversation?.media ?? [])];
    for (const file of files) await this.storage.remove(file.storageKey);

    const counts = await this.prisma.$transaction(async (tx) => {
      // Holds the user row: a claim of theirs still running waits, then fails on the missing user.
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${id} FOR UPDATE`;
      // Holds their carpools too: a seat being taken waits, as it locks its carpool first.
      await tx.$queryRaw`SELECT "id" FROM "Carpool" WHERE "driverId" = ${id} AND "status" IN ('OPEN', 'CLOSED') FOR UPDATE`;
      const now = await this.deletionOf(tx, id);
      if (now.blocking.length > 0) throw this.activeOrders(now.blocking);
      const dispatched = (await tx.order.findMany({ where: { dispatcherId: id }, select: { id: true } })).map((order) => order.id);
      await tx.notification.deleteMany({ where: { orderId: { in: dispatched } } });
      await tx.orderClaim.deleteMany({ where: { driverId: id } });
      const kept = await tx.order.updateMany({ where: { claimedById: id, dispatcherId: { not: id } }, data: { claimedById: null } });
      // A claim that came in after the check moves its order out of this delete; then nothing is deleted.
      const removed = await tx.order.deleteMany({ where: { id: { in: dispatched }, OR: [{ status: { not: 'ASSIGNED' } }, { claimedById: id }] } });
      if (removed.count !== dispatched.length) throw this.activeOrders((await this.deletionOf(tx, id)).blocking);
      await tx.verificationCode.deleteMany({ where: { countryCode: user.countryCode, phone: user.phone } });
      await tx.smsMessage.deleteMany({ where: { countryCode: user.countryCode, phone: user.phone } });
      await tx.user.delete({ where: { id } });
      const detail = {
        phone: `${user.countryCode} ${user.phone}`,
        name: user.profile?.name ?? null,
        dispatchedOrders: removed.count,
        claimedOrdersKept: kept.count,
        reason: input.reason,
      };
      await this.audit.log({ adminId: admin.id, action: 'user.delete', targetType: 'user', targetId: id, detail, ip }, tx);
      return { dispatchedOrders: removed.count, claimedOrdersKept: kept.count };
    }, { timeout: 30_000 });
    return { deleted: true, ...counts };
  }

  private async deletionOf(db: Prisma.TransactionClient, id: string, now = new Date()) {
    const [blocking, dispatched, claimedKept, carpools] = await Promise.all([
      db.order.findMany({
        where: {
          status: 'ASSIGNED',
          OR: [
            { dispatcherId: id, claimedById: { not: id } },
            { claimedById: id, dispatcherId: { not: id } },
          ],
        },
        orderBy: { pickupAt: 'asc' },
        select: { id: true, dispatcherId: true, pickupAt: true, origin: true, destination: true, legIndex: true, journeyKind: true },
      }),
      db.order.count({ where: { dispatcherId: id } }),
      db.order.count({ where: { claimedById: id, dispatcherId: { not: id } } }),
      // 拼車 not yet made into an order, still taking seats or with passengers holding seats:
      // deleting it would leave those passengers' links dead without a word. Once it is an
      // order, the order rules above apply.
      db.carpool.findMany({
        where: {
          driverId: id,
          status: { in: ['OPEN', 'CLOSED'] },
          OR: [
            { status: 'OPEN', closesAt: { gt: now } },
            { seatsList: { some: { OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { gt: now } }] } } },
          ],
        },
        orderBy: { pickupAt: 'asc' },
        select: {
          id: true,
          pickupAt: true,
          origin: true,
          destination: true,
          seatsList: { where: { OR: [{ status: 'CONFIRMED' }, { status: 'PENDING', expiresAt: { gt: now } }] }, select: { id: true } },
        },
      }),
    ]);
    return {
      /** Orders put out by the user, every leg counted; all of them are deleted. */
      dispatchedOrders: dispatched,
      /** Other dispatchers' orders the user took; they stay, without the user. */
      claimedOrdersKept: claimedKept,
      blocking: [
        ...blocking.map((order) => ({
          id: order.id,
          /** DISPATCHED: the user put it out and another driver has it. CLAIMED: the user has another dispatcher's order. */
          role: order.dispatcherId === id ? ('DISPATCHED' as const) : ('CLAIMED' as const),
          pickupAt: order.pickupAt.toISOString(),
          origin: order.origin,
          destination: order.destination,
          legIndex: order.legIndex,
          journeyKind: order.journeyKind,
          parties: null,
        })),
        // CARPOOL: a 拼車 of theirs still taking seats, or with passengers holding seats; the driver cancels it first.
        ...carpools.map((carpool) => ({
          id: carpool.id,
          role: 'CARPOOL' as const,
          pickupAt: carpool.pickupAt.toISOString(),
          origin: carpool.origin,
          destination: carpool.destination,
          legIndex: null,
          journeyKind: null,
          /** Parties holding seats now. */
          parties: carpool.seatsList.length,
        })),
      ],
    };
  }

  private activeOrders(blocking: { id: string }[]) {
    return apiError(HttpStatus.CONFLICT, 'USER_HAS_ACTIVE_ORDERS', 'Trips with someone else are under way', { orders: blocking });
  }

  // ------------------------------------------------- complaints about content

  /** 下架 a 名片頁 after a complaint; see ProfilePagesService.staffBlock. */
  async blockPage(userId: string, input: AdminReason, admin: AdminUser, ip?: string, now = new Date()) {
    await this.ensureUser(userId);
    await this.profilePages.staffBlock(userId, input.reason, now);
    await this.audit.log({ adminId: admin.id, action: 'profile-page.block', targetType: 'user', targetId: userId, detail: { reason: input.reason }, ip });
    return this.getUser(userId, now);
  }

  async restorePage(userId: string, admin: AdminUser, ip?: string) {
    await this.ensureUser(userId);
    await this.profilePages.staffRestore(userId);
    await this.audit.log({ adminId: admin.id, action: 'profile-page.restore', targetType: 'user', targetId: userId, ip });
    return this.getUser(userId);
  }

  /** The user's 特價車, newest first. */
  async userDeals(userId: string) {
    await this.ensureUser(userId);
    return this.deals.staffList(userId);
  }

  /** 下架 a 特價車 after a complaint; the driver sees the reason, and parties still waiting are declined. */
  async cancelDeal(userId: string, dealId: string, input: AdminReason, admin: AdminUser, ip?: string, now = new Date()) {
    await this.ensureUser(userId);
    await this.deals.staffCancel(userId, dealId, input.reason, now);
    await this.audit.log({ adminId: admin.id, action: 'deal.cancel', targetType: 'user', targetId: userId, detail: { dealId, reason: input.reason }, ip });
    return this.deals.staffList(userId, now);
  }

  pagePhoto(userId: string, photoId: string) {
    return this.profilePages.staffPhoto(userId, photoId);
  }

  async removePagePhoto(userId: string, photoId: string, input: AdminReason, admin: AdminUser, ip?: string) {
    await this.profilePages.staffRemovePhoto(userId, photoId);
    await this.audit.log({
      adminId: admin.id,
      action: 'profile-page.photo.remove',
      targetType: 'user',
      targetId: userId,
      detail: { photoId, reason: input.reason },
      ip,
    });
    return this.getUser(userId);
  }

  groupQr(userId: string, inviteId: string) {
    return this.groupInvites.staffQr(userId, inviteId);
  }

  async removeGroupInvite(userId: string, inviteId: string, input: AdminReason, admin: AdminUser, ip?: string) {
    const invite = await this.prisma.groupInvite.findFirst({ where: { id: inviteId, ownerId: userId }, select: { platform: true, name: true, inviteUrl: true } });
    if (!invite) throw apiError(HttpStatus.NOT_FOUND, 'GROUP_INVITE_NOT_FOUND', 'Group not found');
    await this.groupInvites.remove(userId, inviteId);
    await this.audit.log({
      adminId: admin.id,
      action: 'group-invite.remove',
      targetType: 'user',
      targetId: userId,
      detail: { inviteId, platform: invite.platform, name: invite.name, inviteUrl: invite.inviteUrl, reason: input.reason },
      ip,
    });
    return this.getUser(userId);
  }

  /**
   * 代改司機資料: staff correct a driver's details for them (a mistyped plate, a wrong name),
   * under the same rules the driver's own form follows. The log keeps which fields changed.
   */
  async saveUserProfile(id: string, input: DriverProfileInput, admin: AdminUser, ip?: string, now = new Date()) {
    const user = await this.prisma.user.findUnique({ where: { id }, include: { profile: true } });
    if (!user) throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    const data = {
      name: input.name,
      vehicleOwnership: input.vehicleOwnership,
      plateType: input.plateType,
      hkPlate: input.hkPlate || null,
      macauPlate: input.macauPlate || null,
      mainlandPlate: input.mainlandPlate || null,
      vehicleType: input.vehicleType,
      seats: input.seats ?? null,
      color: input.color ?? null,
      hkMacauPhone: input.hkMacauPhone ?? null,
      mainlandPhone: input.mainlandPhone ?? null,
      hidePlates: input.hidePlates,
    };
    const before = user.profile as Record<string, unknown> | null;
    const changed = Object.entries(data)
      .filter(([key, value]) => (before?.[key] ?? null) !== value)
      .map(([key]) => key);
    await this.prisma.$transaction(async (tx) => {
      await tx.driverProfile.upsert({ where: { userId: id }, create: { userId: id, ...data }, update: data });
      await this.audit.log({ adminId: admin.id, action: 'user.profile.update', targetType: 'user', targetId: id, detail: { changed }, ip }, tx);
    });
    return this.getUser(id, now);
  }

  // ----------------------------------------------------------------- orders

  /**
   * 代為取消: staff cancel an order for its dispatcher (a complaint, an abandoned or abusive
   * order). It runs as the dispatcher's own cancel does, so the service fee comes back the
   * same way, and the reason goes in the log. The dispatcher and the driver are both notified.
   */
  async cancelOrder(id: string, input: AdminReason, admin: AdminUser, ip?: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, select: { dispatcherId: true } });
    if (!order) throw apiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    await this.orders.cancelForStaff(order.dispatcherId, id);
    await this.audit.log({ adminId: admin.id, action: 'order.cancel', targetType: 'order', targetId: id, detail: { reason: input.reason }, ip });
    return this.getOrder(id, admin, ip);
  }

  async listOrders(query: AdminOrderQuery, role: AdminRole) {
    const q = query.q;
    const dateField = query.by === 'created' ? 'createdAt' : 'pickupAt';
    const dated = Boolean(query.from || query.to);
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(dated
        ? {
            [dateField]: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00+08:00`) } : {}),
              ...(query.to ? { lt: new Date(new Date(`${query.to}T00:00:00+08:00`).getTime() + DAY_MS) } : {}),
            },
          }
        : {}),
      // The money marks, the search and the user each set fields the others may set too (the status, an OR), so they meet in an AND.
      AND: [
        query.money === 'UNPAID' ? UNPAID : query.money === 'UNSETTLED' ? this.unsettled() : {},
        q
          ? {
              OR: [
                { code: q },
                { origin: { contains: q, mode: 'insensitive' } },
                { destination: { contains: q, mode: 'insensitive' } },
                { dispatcher: { phone: { contains: q } } },
                { claimedBy: { phone: { contains: q } } },
              ],
            }
          : {},
        query.user
          ? query.role === 'dispatcher'
            ? { dispatcherId: query.user }
            : query.role === 'driver'
              ? { claimedById: query.user }
              : { OR: [{ dispatcherId: query.user }, { claimedById: query.user }] }
          : {},
      ],
    };
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        // Looking at some days' trips: in the order of that date, latest first.
        orderBy: dated ? [{ [dateField]: 'desc' }, { createdAt: 'desc' }] : { createdAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          dispatcher: { select: { id: true, countryCode: true, phone: true, profile: { select: { name: true } } } },
          claimedBy: { select: { id: true, countryCode: true, phone: true, profile: { select: { name: true } } } },
          _count: { select: { claims: true } },
        },
      }),
    ]);
    const person = (user: { id: string; countryCode: string; phone: string; profile: { name: string } | null } | null) =>
      user && { id: user.id, name: user.profile?.name ?? null, phone: `${user.countryCode} ${user.phone}` };
    return {
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      canSeePassengers: canSeePassengers(role),
      items: orders.map((order) => ({
        id: order.id,
        code: order.code,
        status: order.status,
        pickupAt: order.pickupAt.toISOString(),
        origin: order.origin,
        destination: order.destination,
        driverPrice: driverPriceOf(order),
        serviceFee: order.commissionMinor === null ? null : order.commissionMinor / 100,
        dispatcher: person(order.dispatcher),
        claimedBy: person(order.claimedBy),
        /** Taken by a driver whose account was deleted since (刪除用戶 keeps when it was taken). */
        driverDeleted: order.claimedAt !== null && order.claimedById === null,
        claimAttempts: order._count.claims,
        passengerConfirmed: Boolean(order.passengerConfirmedAt),
        passengerConfirmedByDispatcher: Boolean(order.passengerConfirmedAt) && order.passengerConfirmedByDispatcher,
        selfDrive: isSelfDriven(order),
        legIndex: order.legIndex,
        journeyKind: order.journeyKind,
        /** 包車: the hours booked, in minutes; null for any other order. */
        charterMinutes: order.charterMinutes,
        /** The dispatcher's own marks; null while not marked. */
        paidAt: order.paidAt?.toISOString() ?? null,
        settledAt: order.settledAt?.toISOString() ?? null,
        createdAt: order.createdAt.toISOString(),
      })),
    };
  }

  async getOrder(id: string, admin: AdminUser, ip?: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        ...orderInclude,
        dispatcher: { select: { id: true, countryCode: true, phone: true, profile: { select: { name: true } } } },
        claims: {
          orderBy: { createdAt: 'asc' },
          include: { driver: { select: { id: true, countryCode: true, phone: true, profile: { select: { name: true } } } } },
        },
      },
    });
    if (!order) throw apiError(HttpStatus.NOT_FOUND, 'ORDER_NOT_FOUND', 'Order not found');
    const showPassenger = canSeePassengers(admin.role);
    if (showPassenger) {
      await this.audit.log({ adminId: admin.id, action: 'order.viewPassenger', targetType: 'order', targetId: id, ip });
    }
    const iso = (date: Date | null) => date?.toISOString() ?? null;
    const claimer = order.claimedBy;
    return {
      id: order.id,
      code: order.code,
      status: order.status,
      pickupAt: order.pickupAt.toISOString(),
      origin: order.origin,
      destination: order.destination,
      waypoints: order.waypoints,
      passengers: order.passengers,
      luggage: order.luggage,
      vehicleType: order.vehicleType,
      notes: order.notes,
      driverPrice: driverPriceOf(order),
      passengerPrice: passengerPriceOf(order),
      showPassengerPrice: order.showPassengerPrice,
      margin: marginOf(order),
      serviceFee: order.commissionMinor === null ? null : order.commissionMinor / 100,
      passenger: showPassenger ? { name: order.passengerName, contact: order.passengerContact } : null,
      selfDrive: isSelfDriven(order),
      inPool: order.inPool,
      /** 接駁 or 往返: this order's place in its trip, and whether one driver takes both legs of a 往返. */
      journey:
        order.legIndex === null
          ? null
          : {
              kind: order.journeyKind ?? 'TRANSFER',
              sameDriver: order.sameDriver,
              legIndex: order.legIndex,
              legCount: order.journeyHead?.journeyLegs.length ?? order.legIndex,
            },
      /** 包車: the hours booked and the prices an hour; the order's prices are those times the hours. */
      charter:
        order.charterMinutes === null
          ? null
          : {
              minutes: order.charterMinutes,
              driverHourly: order.driverHourlyMinor === null ? null : { amount: order.driverHourlyMinor / 100, currency: order.driverCurrency },
              passengerHourly: order.passengerHourlyMinor === null ? null : { amount: order.passengerHourlyMinor / 100, currency: order.passengerCurrency },
            },
      /** Minutes before pickup at which the driver sees the passenger's phone; null means as soon as claimed. */
      contactRevealMinutes: order.contactRevealMinutes,
      fromBooking: Boolean(order.booking),
      /** The dispatcher's own marks and choices about money; the platform handles none of it. */
      payment: { showPaymentMethods: order.showPaymentMethods, paidAt: iso(order.paidAt), settledAt: iso(order.settledAt) },
      /** 行程群: only that there is one and of which kind; the way in stays with the people on the trip. */
      tripGroup: ((group) => group && { platform: group.platform, expiresAt: iso(group.expiresAt) })(order.journeyHead?.tripGroup ?? order.tripGroup),
      dispatcher: {
        id: order.dispatcher.id,
        name: order.dispatcher.profile?.name ?? null,
        phone: `${order.dispatcher.countryCode} ${order.dispatcher.phone}`,
      },
      driverDeleted: order.claimedAt !== null && order.claimedById === null,
      driver: claimer && order.claimedById && { id: order.claimedById, name: claimer.profile?.name ?? null, phone: `${claimer.countryCode} ${claimer.phone}`, profile: claimer.profile },
      /** 出單者代確認: the dispatcher, not the passenger, confirmed the trip. */
      passengerConfirmedByDispatcher: Boolean(order.passengerConfirmedAt) && order.passengerConfirmedByDispatcher,
      timeline: {
        createdAt: order.createdAt.toISOString(),
        claimedAt: iso(order.claimedAt),
        passengerConfirmedAt: iso(order.passengerConfirmedAt),
        completedAt: iso(order.completedAt),
        cancelledAt: iso(order.cancelledAt),
      },
      claims: order.claims.map((claim) => ({
        result: claim.result,
        createdAt: claim.createdAt.toISOString(),
        driver: {
          id: claim.driver.id,
          name: claim.driver.profile?.name ?? null,
          phone: `${claim.driver.countryCode} ${claim.driver.phone}`,
        },
      })),
    };
  }

  // -------------------------------------------------------- billing control

  async billingCatalogue(now = new Date()) {
    const [features, plans, policies] = await Promise.all([
      this.prisma.feature.findMany({ orderBy: { key: 'asc' } }),
      this.prisma.plan.findMany({ orderBy: { rank: 'asc' }, include: { features: true } }),
      this.prisma.billingPolicy.findMany({ orderBy: { createdAt: 'desc' } }),
    ]);
    return {
      features,
      plans: plans.map((plan) => ({
        key: plan.key,
        name: plan.name,
        rank: plan.rank,
        isDefault: plan.isDefault,
        grants: Object.fromEntries(plan.features.map((f) => [f.featureKey, { enabled: f.enabled, quota: f.quota }])),
      })),
      policies: policies.map((policy) => ({
        id: policy.id,
        name: policy.name,
        planKey: policy.planKey,
        featureKey: policy.featureKey,
        startsAt: policy.startsAt.toISOString(),
        endsAt: policy.endsAt?.toISOString() ?? null,
        active: policy.active,
        inEffect: policy.active && policy.startsAt <= now && (!policy.endsAt || policy.endsAt > now),
      })),
    };
  }

  async setPlanFeature(planKey: string, featureKey: string, input: AdminPlanFeature, admin: AdminUser, ip?: string) {
    const [plan, feature] = await Promise.all([
      this.prisma.plan.findUnique({ where: { key: planKey } }),
      this.prisma.feature.findUnique({ where: { key: featureKey } }),
    ]);
    if (!plan || !feature) throw apiError(HttpStatus.NOT_FOUND, 'PLAN_OR_FEATURE_NOT_FOUND', 'Unknown plan or feature');
    const quota = feature.kind === 'QUOTA' ? input.quota : null;
    await this.prisma.planFeature.upsert({
      where: { planKey_featureKey: { planKey, featureKey } },
      create: { planKey, featureKey, enabled: input.enabled, quota },
      update: { enabled: input.enabled, quota },
    });
    await this.audit.log({
      adminId: admin.id,
      action: 'billing.plan.feature',
      targetType: 'plan',
      targetId: planKey,
      detail: { featureKey, enabled: input.enabled, quota },
      ip,
    });
    return this.billingCatalogue();
  }

  async createPolicy(input: AdminPolicyCreate, admin: AdminUser, ip?: string) {
    const policy = await this.prisma.billingPolicy.create({
      data: {
        name: input.name,
        planKey: input.planKey,
        featureKey: input.featureKey,
        startsAt: input.startsAt ?? new Date(),
        endsAt: input.endsAt,
      },
    });
    await this.audit.log({
      adminId: admin.id,
      action: 'billing.policy.create',
      targetType: 'billingPolicy',
      targetId: policy.id,
      detail: { name: input.name, planKey: input.planKey, featureKey: input.featureKey },
      ip,
    });
    return this.billingCatalogue();
  }

  async updatePolicy(id: string, input: AdminPolicyUpdate, admin: AdminUser, ip?: string) {
    const updated = await this.prisma.billingPolicy.updateMany({
      where: { id },
      data: {
        ...(input.active === undefined ? {} : { active: input.active }),
        ...(input.endsAt === undefined ? {} : { endsAt: input.endsAt === null ? null : new Date(input.endsAt) }),
      },
    });
    if (updated.count === 0) throw apiError(HttpStatus.NOT_FOUND, 'POLICY_NOT_FOUND', 'Policy not found');
    await this.audit.log({ adminId: admin.id, action: 'billing.policy.update', targetType: 'billingPolicy', targetId: id, detail: input, ip });
    return this.billingCatalogue();
  }

  private async ensureUser(id: string) {
    if (!(await this.prisma.user.findUnique({ where: { id }, select: { id: true } }))) {
      throw apiError(HttpStatus.NOT_FOUND, 'USER_NOT_FOUND', 'User not found');
    }
  }
}
