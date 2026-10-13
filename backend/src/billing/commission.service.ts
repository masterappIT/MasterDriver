import { Inject, Injectable } from '@nestjs/common';
import type { CommissionUpdate } from '@masterdriver/shared';
import type { Prisma } from '../../generated/prisma';
import { EntitlementsService } from '../entitlements/entitlements.service';
import { PrismaService } from '../prisma.service';

type Db = Prisma.TransactionClient;
const SETTING_ID = 'default';

/** Plans with this feature (team, company) and the launch free period pay no service fee. */
export const COMMISSION_EXEMPT_FEATURE = 'commission.exempt';

export interface CommissionStatus {
  enabled: boolean;
  fee: { amount: number; currency: string };
  updatedAt: string;
  updatedBy: string | null;
}

/**
 * The platform service fee (抽水): a fixed amount per order, charged to the
 * dispatcher. Switched on and priced in the platform admin; off by default.
 */
@Injectable()
export class CommissionService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(EntitlementsService) private readonly entitlements: EntitlementsService,
  ) {}

  private setting(db: Db = this.prisma) {
    return db.commissionSetting.upsert({ where: { id: SETTING_ID }, update: {}, create: { id: SETTING_ID } });
  }

  async status(): Promise<CommissionStatus> {
    const setting = await this.setting();
    return {
      enabled: setting.enabled,
      fee: { amount: setting.feeMinor / 100, currency: setting.currency },
      updatedAt: setting.updatedAt.toISOString(),
      updatedBy: setting.updatedBy,
    };
  }

  async update(input: CommissionUpdate, actor: string): Promise<CommissionStatus> {
    await this.setting();
    await this.prisma.commissionSetting.update({
      where: { id: SETTING_ID },
      data: {
        ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
        ...(input.fee === undefined ? {} : { feeMinor: Math.round(input.fee * 100) }),
        updatedBy: actor,
      },
    });
    return this.status();
  }

  /** The fee this dispatcher pays for a new order now: 0 when off, free or exempt. */
  async feeFor(db: Db, userId: string, now = new Date()): Promise<number> {
    const setting = await this.setting(db);
    if (!setting.enabled || setting.feeMinor <= 0) return 0;
    const exempt = await this.entitlements.check(userId, COMMISSION_EXEMPT_FEATURE, now, db);
    return exempt.enabled ? 0 : setting.feeMinor;
  }

  /** What the signed-in dispatcher will pay per order, for the app to show before sending. */
  async forUser(userId: string, now = new Date()) {
    const setting = await this.setting();
    const feeMinor = await this.feeFor(this.prisma, userId, now);
    return {
      enabled: setting.enabled,
      feePerOrder: { amount: feeMinor / 100, currency: setting.currency },
      exempt: setting.enabled && setting.feeMinor > 0 && feeMinor === 0,
    };
  }
}
