import { HttpStatus } from '@nestjs/common';
import type { BookingStatus, Prisma } from '../../generated/prisma';
import { apiError } from '../common/errors';
import type { PrismaService } from '../prisma.service';

/** A booking that has the deal: booked with 自動接受第一組, or made into an order. */
export const HOLDING: BookingStatus[] = ['ACCEPTED', 'ORDERED'];
/** A booking still waiting on the driver or on its order. */
const WAITING: BookingStatus[] = ['PENDING', 'QUOTED', 'ACCEPTED'];

/** Holds the deal's row until the transaction ends: a booking, 成單 or 下架 at the same moment waits. */
export async function lockDeal(tx: Prisma.TransactionClient, dealId: string) {
  await tx.$queryRaw`SELECT "id" FROM "Deal" WHERE "id" = ${dealId} FOR UPDATE`;
  return tx.deal.findUniqueOrThrow({ where: { id: dealId } });
}

/**
 * 成單 from a 特價車 booking is the driver accepting that party: the deal is theirs, and every
 * other party still waiting is declined (one car, one party). Another party already holding it,
 * or a deal taken down, stops the order from being made. Nothing happens for a 名片頁 request.
 */
export async function takeDeal(tx: Prisma.TransactionClient, bookingId: string, now: Date) {
  const booking = await tx.bookingRequest.findUnique({ where: { id: bookingId }, select: { dealId: true } });
  if (!booking?.dealId) return;
  const deal = await lockDeal(tx, booking.dealId);
  if (deal.status === 'CANCELLED') throw apiError(HttpStatus.CONFLICT, 'DEAL_CANCELLED', 'This deal was taken down');
  const other = await tx.bookingRequest.count({ where: { dealId: deal.id, id: { not: bookingId }, status: { in: HOLDING } } });
  if (other > 0) throw apiError(HttpStatus.CONFLICT, 'DEAL_TAKEN', 'Another passenger already has this deal');
  if (deal.status !== 'SOLD') await tx.deal.update({ where: { id: deal.id }, data: { status: 'SOLD', soldAt: now } });
  await tx.bookingRequest.updateMany({
    where: { dealId: deal.id, id: { not: bookingId }, orderId: null, status: { in: WAITING } },
    data: { status: 'DECLINED' },
  });
}

/**
 * The party holding a deal let go of it before it became an order (the passenger cancelled, or
 * the driver declined them): the deal takes bookings again. One taken down stays down.
 */
export async function releaseDeal(prisma: PrismaService, dealId: string) {
  await prisma.$transaction(async (tx) => {
    const deal = await lockDeal(tx, dealId);
    if (deal.status !== 'SOLD') return;
    if ((await tx.bookingRequest.count({ where: { dealId, status: { in: HOLDING } } })) > 0) return;
    await tx.deal.update({ where: { id: dealId }, data: { status: 'OPEN', soldAt: null } });
  });
}

/** 下架: the deal stops taking bookings, and every party still waiting is declined. */
export async function takeDown(tx: Prisma.TransactionClient, dealId: string, now: Date, staffReason: string | null) {
  const deal = await lockDeal(tx, dealId);
  if (deal.status === 'CANCELLED') throw apiError(HttpStatus.CONFLICT, 'DEAL_CANCELLED', 'This deal was taken down');
  if ((await tx.bookingRequest.count({ where: { dealId, status: 'ORDERED' } })) > 0) {
    throw apiError(HttpStatus.CONFLICT, 'DEAL_ORDERED', 'This deal is an order already; cancel the order instead');
  }
  await tx.deal.update({ where: { id: dealId }, data: { status: 'CANCELLED', cancelledAt: now, staffReason } });
  await tx.bookingRequest.updateMany({ where: { dealId, orderId: null, status: { in: WAITING } }, data: { status: 'DECLINED' } });
}
