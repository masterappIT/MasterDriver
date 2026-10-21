-- 特價車 the driver deleted (2026-10-22): hidden from them and from its link, kept for its bookings.
-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "deletedAt" TIMESTAMP(3);
