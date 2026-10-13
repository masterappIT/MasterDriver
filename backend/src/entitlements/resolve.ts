export interface Grant {
  enabled: boolean;
  /** Monthly quota for QUOTA features; null means unlimited. */
  quota: number | null;
}

export type PlanFeatures = Record<string, Record<string, Grant>>;

interface Window {
  startsAt: Date;
  endsAt?: Date | null;
}

export interface OverrideInput extends Window {
  planKey?: string | null;
  featureKey?: string | null;
  enabled?: boolean | null;
  quota?: number | null;
}

export interface PolicyInput extends Window {
  planKey?: string | null;
  featureKey?: string | null;
  active: boolean;
}

export interface ResolveInput {
  featureKey: string;
  now: Date;
  plans: PlanFeatures;
  defaultPlanKey: string | null;
  overrides: OverrideInput[];
  policies: PolicyInput[];
  subscriptionPlanKeys: string[];
}

export type GrantSource = 'override' | 'feature-policy' | 'plan-policy' | 'subscription' | 'default' | 'none';

export interface Entitlement extends Grant {
  source: GrantSource;
}

const isActive = (window: Window, now: Date) => window.startsAt <= now && (!window.endsAt || window.endsAt > now);

/** Higher is more generous: disabled < limited quota < unlimited. */
function generosity(grant: Grant): number {
  if (!grant.enabled) return -1;
  return grant.quota === null ? Number.POSITIVE_INFINITY : grant.quota;
}

/**
 * Decides whether a user may use a feature and with what monthly quota.
 *
 * 1. A per-user override for this feature wins outright (it may also restrict).
 * 2. A per-user override granting a plan wins next.
 * 3. A site-wide "this feature is free" policy grants unlimited use.
 * 4. Otherwise the most generous of: site-wide plan policies (e.g. the launch free
 *    period), the user's active subscriptions and the default plan. A paying user
 *    never gets less during a free period, and vice versa.
 */
export function resolveEntitlement(input: ResolveInput): Entitlement {
  const { featureKey, now, plans } = input;
  const planGrant = (planKey: string | null | undefined) => (planKey ? plans[planKey]?.[featureKey] : undefined);

  const overrides = input.overrides.filter((override) => isActive(override, now));
  const featureOverride = overrides.find((override) => override.featureKey === featureKey);
  if (featureOverride) {
    return { enabled: featureOverride.enabled ?? true, quota: featureOverride.quota ?? null, source: 'override' };
  }
  const planOverride = overrides.map((override) => planGrant(override.planKey)).find(Boolean);
  if (planOverride) return { ...planOverride, source: 'override' };

  const policies = input.policies.filter((policy) => policy.active && isActive(policy, now));
  if (policies.some((policy) => policy.featureKey === featureKey)) {
    return { enabled: true, quota: null, source: 'feature-policy' };
  }

  const candidates: Entitlement[] = [];
  for (const policy of policies) {
    const grant = planGrant(policy.planKey);
    if (grant) candidates.push({ ...grant, source: 'plan-policy' });
  }
  for (const planKey of input.subscriptionPlanKeys) {
    const grant = planGrant(planKey);
    if (grant) candidates.push({ ...grant, source: 'subscription' });
  }
  const defaultGrant = planGrant(input.defaultPlanKey);
  if (defaultGrant) candidates.push({ ...defaultGrant, source: 'default' });

  if (candidates.length === 0) return { enabled: false, quota: null, source: 'none' };
  return candidates.reduce((best, next) => (generosity(next) > generosity(best) ? next : best));
}
