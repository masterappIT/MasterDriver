import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { apiError } from '../common/errors';
import { monthPeriod } from '../common/hong-kong-time';
import { PrismaService } from '../prisma.service';
import { Entitlement, PlanFeatures, resolveEntitlement } from './resolve';

/** Feature keys used by the API. The catalogue itself lives in the Feature table. */
export const FEATURES = {
  orderCreate: 'order.create',
} as const;

type Db = Prisma.TransactionClient;

@Injectable()
export class EntitlementsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async check(userId: string, featureKey: string, now = new Date(), db: Db = this.prisma): Promise<Entitlement> {
    const [planFeatures, defaultPlan, overrides, policies, subscriptions] = await Promise.all([
      db.planFeature.findMany({ where: { featureKey } }),
      db.plan.findFirst({ where: { isDefault: true }, select: { key: true } }),
      db.entitlementOverride.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } }),
      db.billingPolicy.findMany({ where: { active: true } }),
      db.subscription.findMany({
        where: { userId, status: 'ACTIVE', startsAt: { lte: now }, OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
        select: { planKey: true },
      }),
    ]);

    const plans: PlanFeatures = {};
    for (const row of planFeatures) {
      plans[row.planKey] = { ...plans[row.planKey], [row.featureKey]: { enabled: row.enabled, quota: row.quota } };
    }

    return resolveEntitlement({
      featureKey,
      now,
      plans,
      defaultPlanKey: defaultPlan?.key ?? null,
      overrides,
      policies,
      subscriptionPlanKeys: subscriptions.map((subscription) => subscription.planKey),
    });
  }

  /**
   * Checks the entitlement and records one use for this month in a single atomic
   * statement, so concurrent requests cannot exceed the quota. Call it inside the
   * transaction that performs the action.
   */
  async consume(db: Db, userId: string, featureKey: string, now = new Date()): Promise<Entitlement> {
    const entitlement = await this.check(userId, featureKey, now, db);
    if (!entitlement.enabled) {
      throw apiError(HttpStatus.FORBIDDEN, 'FEATURE_NOT_AVAILABLE', `${featureKey} is not available on this plan`);
    }
    const period = monthPeriod(now);
    const quota = entitlement.quota;
    if (quota !== null && quota <= 0) throw this.quotaExceeded(featureKey, quota);

    const rows = await db.$queryRaw<{ used: number }[]>`
      INSERT INTO "Usage" ("userId", "featureKey", "period", "used")
      VALUES (${userId}, ${featureKey}, ${period}, 1)
      ON CONFLICT ("userId", "featureKey", "period")
      DO UPDATE SET "used" = "Usage"."used" + 1
      WHERE ${quota}::int IS NULL OR "Usage"."used" < ${quota}::int
      RETURNING "used"`;
    if (rows.length === 0) throw this.quotaExceeded(featureKey, quota);
    return entitlement;
  }

  private quotaExceeded(featureKey: string, quota: number | null) {
    return apiError(HttpStatus.FORBIDDEN, 'QUOTA_EXCEEDED', `Monthly quota for ${featureKey} is used up`, { quota });
  }
}
