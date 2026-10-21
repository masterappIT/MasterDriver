import { HttpStatus } from '@nestjs/common';
import type { BookingStatus, Prisma } from '../../generated/prisma';
import { apiError } from '../common/errors';

/** A booking that takes a place in 最多接幾組: waiting for the driver, booked, or made into an order. */
export const ACTIVE: BookingStatus[] = ['PENDING', 'QUOTED', 'ACCEPTED', 'ORDERED'];
/** A booking still waiting on the driver or on its order. */
const WAITING: BookingStatus[] = ['PENDING', 'QUOTED', 'ACCEPTED'];

/** Holds the deal's row until the transaction ends: two bookings for the last place, or a booking and 關閉, wait in turn. */
export async function lockDeal(tx: Prisma.TransactionClient, dealId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Deal" WHERE "id" = ${dealId} FOR UPDATE`;
  return tx.deal.findUniqueOrThrow({ where: { id: dealId } });
}

/**
 * 下架 by the platform's staff: the deal takes no more bookings, and the parties still waiting
 * are declined. Orders already made from it stay as they are.
 */
export async function takeDown(tx: Prisma.TransactionClient, dealId: string, now: Date, staffReason: string) {
  const deal = await lockDeal(tx, dealId);
  if (deal.status === 'CANCELLED') throw apiError(HttpStatus.CONFLICT, 'DEAL_CANCELLED', 'This deal was taken down');
  await tx.deal.update({ where: { id: dealId }, data: { status: 'CANCELLED', cancelledAt: now, staffReason } });
  await tx.bookingRequest.updateMany({ where: { dealId, orderId: null, status: { in: WAITING } }, data: { status: 'DECLINED' } });
}
