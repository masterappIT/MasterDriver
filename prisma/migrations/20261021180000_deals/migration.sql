-- 特價車 (2026-10-21): a trip a driver offers at their own price, whole car, to one party who
-- books it from the driver's link (/d/{code}); its bookings are BookingRequest rows with dealId.
-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'SOLD', 'CANCELLED');

-- AlterEnum

ALTER TYPE "NotificationKind" ADD VALUE 'DEAL_BOOKING_NEW';
ALTER TYPE "NotificationKind" ADD VALUE 'DEAL_SOLD';

-- AlterTable
ALTER TABLE "BookingRequest" ADD COLUMN     "dealId" TEXT;

-- CreateTable
CREATE TABLE "Deal" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "pickupUntil" TIMESTAMP(3),
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "priceMinor" INTEGER NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'CNY',
    "originalPriceMinor" INTEGER,
    "maxPassengers" INTEGER,
    "maxLuggage" INTEGER,
    "notes" TEXT,
    "autoAccept" BOOLEAN NOT NULL DEFAULT false,
    "soldAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "staffReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Deal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Deal_code_key" ON "Deal"("code");

-- CreateIndex
CREATE INDEX "Deal_driverId_createdAt_idx" ON "Deal"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingRequest_dealId_status_idx" ON "BookingRequest"("dealId", "status");

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

