import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma';
import { apiError } from '../common/errors';
import { PrismaService } from '../prisma.service';

type Db = Prisma.TransactionClient;
export type TopUpSource = 'STRIPE' | 'ALIPAY_HK' | 'MANUAL';

const RECENT_ENTRIES = 20;

/**
 * Prepaid credits. Every balance change is one atomic statement plus a ledger
 * entry in the caller's transaction, so concurrent orders can never spend more
 * than the balance and the ledger always adds up to it.
 */
@Injectable()
export class CreditsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async summary(userId: string) {
    const [account, entries] = await Promise.all([
      this.prisma.creditAccount.findUnique({ where: { userId } }),
      this.prisma.creditEntry.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: RECENT_ENTRIES }),
    ]);
    return {
      balance: { amount: (account?.balanceMinor ?? 0) / 100, currency: account?.currency ?? 'HKD' },
      entries: entries.map((entry) => ({
        type: entry.type,
        amount: entry.amountMinor / 100,
        balanceAfter: entry.balanceAfterMinor / 100,
        orderId: entry.orderId,
        source: entry.source,
        note: entry.note,
        createdAt: entry.createdAt.toISOString(),
      })),
    };
  }

  /** Debits a fee for an order; fails with INSUFFICIENT_CREDITS without changing anything. */
  async charge(db: Db, userId: string, orderId: string, amountMinor: number) {
    await db.creditAccount.upsert({ where: { userId }, update: {}, create: { userId } });
    const rows = await db.$queryRaw<{ balanceMinor: number }[]>`
      UPDATE "CreditAccount" SET "balanceMinor" = "balanceMinor" - ${amountMinor}, "updatedAt" = NOW()
      WHERE "userId" = ${userId} AND "balanceMinor" >= ${amountMinor}
      RETURNING "balanceMinor"`;
    if (rows.length === 0) {
      throw apiError(HttpStatus.PAYMENT_REQUIRED, 'INSUFFICIENT_CREDITS', 'Not enough credits for the service fee', {
        fee: amountMinor / 100,
      });
    }
    await db.creditEntry.create({
      data: { userId, type: 'CHARGE', amountMinor: -amountMinor, balanceAfterMinor: rows[0].balanceMinor, orderId },
    });
  }

  /** Returns an order's fee once. Safe to call for orders that were never charged. */
  async refundOrder(db: Db, orderId: string) {
    const charge = await db.creditEntry.findUnique({ where: { orderId_type: { orderId, type: 'CHARGE' } } });
    if (!charge) return;
    const already = await db.creditEntry.findUnique({ where: { orderId_type: { orderId, type: 'REFUND' } } });
    if (already) return;
    const amountMinor = -charge.amountMinor;
    const account = await db.creditAccount.update({
      where: { userId: charge.userId },
      data: { balanceMinor: { increment: amountMinor } },
    });
    await db.creditEntry.create({
      data: { userId: charge.userId, type: 'REFUND', amountMinor, balanceAfterMinor: account.balanceMinor, orderId },
    });
  }

  /**
   * Adds credits (TOPUP, from a payment or by hand) or corrects a balance
   * (ADJUST, may be negative but never below zero).
   */
  async credit(
    userId: string,
    amountMinor: number,
    entry: { type: 'TOPUP' | 'ADJUST'; source?: TopUpSource; note?: string; createdBy: string },
  ) {
    if (!Number.isInteger(amountMinor) || amountMinor === 0) throw new Error('amountMinor must be a non-zero integer');
    if (entry.type === 'TOPUP' && amountMinor < 0) throw new Error('A top-up must be positive');
    return this.prisma.$transaction(async (tx) => {
      await tx.creditAccount.upsert({ where: { userId }, update: {}, create: { userId } });
      const rows = await tx.$queryRaw<{ balanceMinor: number }[]>`
        UPDATE "CreditAccount" SET "balanceMinor" = "balanceMinor" + ${amountMinor}, "updatedAt" = NOW()
        WHERE "userId" = ${userId} AND "balanceMinor" + ${amountMinor} >= 0
        RETURNING "balanceMinor"`;
      if (rows.length === 0) throw apiError(HttpStatus.CONFLICT, 'BALANCE_WOULD_BE_NEGATIVE', 'Adjustment exceeds the balance');
      await tx.creditEntry.create({
        data: {
          userId,
          type: entry.type,
          amountMinor,
          balanceAfterMinor: rows[0].balanceMinor,
          source: entry.source,
          note: entry.note,
          createdBy: entry.createdBy,
        },
      });
      return rows[0].balanceMinor;
    });
  }
}
