import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type {
  AdminCreditChange,
  AdminOrderQuery,
  AdminOverrideCreate,
  AdminPlanFeature,
  AdminPolicyCreate,
  AdminPolicyUpdate,
  AdminRole,
  PageQuery,
} from '@masterdriver/shared';
import type { Prisma } from '../../generated/prisma';
import { CommissionService, COMMISSION_EXEMPT_FEATURE } from '../billing/commission.service';
import { CreditsService } from '../billing/credits.service';
import { apiError } from '../common/errors';
import { EntitlementsService, FEATURES } from '../entitlements/entitlements.service';
import { driverPriceOf, isSelfDriven, passengerPriceOf, marginOf, orderInclude } from '../orders/order-view';
import { PrismaService } from '../prisma.service';
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
  ) {}

  // -------------------------------------------------------------- dashboard

  async dashboard(now = new Date()) {
    const today = startOfHongKongDay(now);
    const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
    const [users, newUsers, ordersToday, ordersWeek, byStatus, claimsWeek, dispatchers, credits, fee, devLogin, freePeriods, supportWaiting, unpaid, unsettled, bookingsWeek, bookingsPending] =
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
        this.prisma.order.count({ where: { ...UNPAID, status: 'COMPLETED' } }),
        this.prisma.order.count({ where: this.unsettled() }),
        this.prisma.bookingRequest.count({ where: { createdAt: { gte: weekAgo } } }),
        this.prisma.bookingRequest.count({ where: { status: 'PENDING' } }),
      ]);
    return {
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

  async listUsers(query: PageQuery) {
    const where: Prisma.UserWhereInput = query.q
      ? { OR: [{ phone: { contains: query.q } }, { profile: { name: { contains: query.q, mode: 'insensitive' } } }] }
      : {};
    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * PAGE_SIZE,
        take: PAGE_SIZE,
        include: {
          profile: { select: { name: true, plateType: true, hkPlate: true, macauPlate: true, mainlandPlate: true } },
          profilePage: { select: { published: true } },
          creditAccount: { select: { balanceMinor: true } },
          _count: { select: { dispatchedOrders: true, claimedOrders: true } },
        },
      }),
    ]);
    return {
      total,
      page: query.page,
      pageSize: PAGE_SIZE,
      items: users.map((user) => ({
        id: user.id,
        phone: `${user.countryCode} ${user.phone}`,
        name: user.profile?.name ?? null,
        plates: [user.profile?.hkPlate, user.profile?.macauPlate, user.profile?.mainlandPlate].filter(Boolean),
        plateType: user.profile?.plateType ?? null,
        pagePublished: user.profilePage?.published ?? false,
        dispatched: user._count.dispatchedOrders,
        claimed: user._count.claimedOrders,
        credits: (user.creditAccount?.balanceMinor ?? 0) / 100,
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
        profilePage: { select: { code: true, published: true, wechatId: true, whatsapp: true, _count: { select: { photos: true, bookings: true } } } },
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
      profile: user.profile,
      counts: { dispatched: user._count.dispatchedOrders, claimed: user._count.claimedOrders },
      /** 名片頁, as the driver set it up; null when they never opened the editor. */
      profilePage: user.profilePage && {
        code: user.profilePage.code,
        published: user.profilePage.published,
        wechatId: user.profilePage.wechatId || null,
        whatsapp: user.profilePage.whatsapp || null,
        photos: user.profilePage._count.photos,
        bookings: user.profilePage._count.bookings,
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

  // ----------------------------------------------------------------- orders

  async listOrders(query: AdminOrderQuery, role: AdminRole) {
    const q = query.q;
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.money === 'UNPAID' ? UNPAID : query.money === 'UNSETTLED' ? this.unsettled() : {}),
      ...(q
        ? {
            OR: [
              { code: q },
              { origin: { contains: q, mode: 'insensitive' } },
              { destination: { contains: q, mode: 'insensitive' } },
              { dispatcher: { phone: { contains: q } } },
              { claimedBy: { phone: { contains: q } } },
            ],
          }
        : {}),
    };
    const [total, orders] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
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
        claimAttempts: order._count.claims,
        passengerConfirmed: Boolean(order.passengerConfirmedAt),
        selfDrive: isSelfDriven(order),
        legIndex: order.legIndex,
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
      /** 接駁: this order's place in its trip. */
      journey: order.legIndex === null ? null : { legIndex: order.legIndex, legCount: order.journeyHead?.journeyLegs.length ?? order.legIndex },
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
      driver: claimer && { name: claimer.profile?.name ?? null, phone: `${claimer.countryCode} ${claimer.phone}`, profile: claimer.profile },
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
