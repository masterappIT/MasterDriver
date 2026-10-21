-- 往返單 (2026-10-21): a trip of two legs is either 接駁 or 往返 (A to B and back), and a 往返 is
-- taken by one driver for both legs or claimed leg by leg. 名片頁 bookings may ask for 往返.
-- CreateEnum
CREATE TYPE "JourneyKind" AS ENUM ('TRANSFER', 'ROUND_TRIP');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "journeyKind" "JourneyKind",
ADD COLUMN "sameDriver" BOOLEAN NOT NULL DEFAULT false;

-- Every trip until now was 接駁.
UPDATE "Order" SET "journeyKind" = 'TRANSFER' WHERE "journeyId" IS NOT NULL;

-- AlterTable
ALTER TABLE "BookingRequest" ADD COLUMN "roundTrip" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "returnPickupAt" TIMESTAMP(3);
