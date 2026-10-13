import { z } from 'zod';

export const ADMIN_ROLES = ['SUPER_ADMIN', 'OPERATOR', 'SALES'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const adminLoginSchema = z.object({
  username: z.string().trim().min(1).max(40),
  password: z.string().min(1).max(200),
});
export type AdminLogin = z.infer<typeof adminLoginSchema>;

export const adminPasswordChangeSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().min(12).max(200),
});
export type AdminPasswordChange = z.infer<typeof adminPasswordChangeSchema>;

export const adminCreateSchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-z0-9._-]{3,40}$/),
  displayName: z.string().trim().min(1).max(40),
  role: z.enum(ADMIN_ROLES),
});
export type AdminCreate = z.infer<typeof adminCreateSchema>;

export const pageQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  q: z
    .string()
    .trim()
    .max(60)
    .optional()
    .transform((value) => value || undefined),
});

export const adminOrderQuerySchema = pageQuerySchema.extend({
  status: z.enum(['OPEN', 'ASSIGNED', 'COMPLETED', 'CANCELLED']).optional(),
  /** Orders that still wait on money: the fare not marked received, or the driver not marked settled. */
  money: z.enum(['UNPAID', 'UNSETTLED']).optional(),
});
export type AdminOrderQuery = z.infer<typeof adminOrderQuerySchema>;
export type PageQuery = z.infer<typeof pageQuerySchema>;

export const adminAuditQuerySchema = pageQuerySchema.extend({
  action: z.string().trim().max(60).optional(),
});
export type AdminAuditQuery = z.infer<typeof adminAuditQuerySchema>;

/** Manual credit change: TOPUP adds (e.g. paid by 轉數快); ADJUST corrects either way. */
export const adminCreditChangeSchema = z.object({
  type: z.enum(['TOPUP', 'ADJUST']),
  amount: z
    .number()
    .refine((value) => value !== 0 && Math.abs(value) <= 100_000)
    .refine((value) => Number.isInteger(Math.round(value * 100))),
  note: z.string().trim().min(1).max(200),
});
export type AdminCreditChange = z.infer<typeof adminCreditChangeSchema>;

const optionalDate = z
  .string()
  .datetime({ offset: true })
  .optional()
  .transform((value) => (value ? new Date(value) : undefined));

/** A per-user grant: a whole plan (gift, trial, Master Travel customer) or one feature. */
export const adminOverrideCreateSchema = z
  .object({
    planKey: z.string().max(40).optional(),
    featureKey: z.string().max(60).optional(),
    enabled: z.boolean().optional(),
    quota: z.number().int().min(0).nullable().optional(),
    startsAt: optionalDate,
    endsAt: optionalDate,
    reason: z.string().trim().min(1).max(200),
  })
  .refine((value) => Boolean(value.planKey) !== Boolean(value.featureKey), { message: 'PLAN_OR_FEATURE' });
export type AdminOverrideCreate = z.infer<typeof adminOverrideCreateSchema>;

export const adminPlanFeatureSchema = z.object({
  enabled: z.boolean(),
  /** Monthly quota for QUOTA features; null means unlimited. */
  quota: z.number().int().min(0).nullable(),
});
export type AdminPlanFeature = z.infer<typeof adminPlanFeatureSchema>;

/** A site-wide free period (planKey) or a single free feature (featureKey). */
export const adminPolicyCreateSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    planKey: z.string().max(40).optional(),
    featureKey: z.string().max(60).optional(),
    startsAt: optionalDate,
    endsAt: optionalDate,
  })
  .refine((value) => Boolean(value.planKey) !== Boolean(value.featureKey), { message: 'PLAN_OR_FEATURE' });
export type AdminPolicyCreate = z.infer<typeof adminPolicyCreateSchema>;

export const adminPolicyUpdateSchema = z
  .object({
    active: z.boolean().optional(),
    endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  })
  .refine((value) => value.active !== undefined || value.endsAt !== undefined, { message: 'NOTHING_TO_UPDATE' });
export type AdminPolicyUpdate = z.infer<typeof adminPolicyUpdateSchema>;

/** 客服: which conversations the inbox lists. */
export const adminSupportQuerySchema = pageQuerySchema.extend({
  filter: z.enum(['waiting', 'all']).default('waiting'),
});
export type AdminSupportQuery = z.infer<typeof adminSupportQuerySchema>;

export const adminSupportOpenSchema = z.object({ userId: z.string().trim().min(1).max(40) });
export type AdminSupportOpen = z.infer<typeof adminSupportOpenSchema>;
