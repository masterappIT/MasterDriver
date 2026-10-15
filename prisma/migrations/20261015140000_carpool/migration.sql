-- 拼車: a trip a driver opens for passengers to ask for seats on, through a link the driver
-- gives them (trial on branch claude/group-purchase-feature-423f8a, 2026-10-15).
-- CreateEnum
CREATE TYPE "CarpoolStatus" AS ENUM ('OPEN', 'CLOSED', 'ORDERED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CarpoolSeatStatus" AS ENUM ('PENDING', 'CONFIRMED', 'DECLINED', 'EXPIRED', 'CANCELLED', 'REMOVED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'CARPOOL_SEAT_NEW';
ALTER TYPE "NotificationKind" ADD VALUE 'CARPOOL_SEAT_WAITING';
ALTER TYPE "NotificationKind" ADD VALUE 'CARPOOL_SEAT_CANCELLED';
ALTER TYPE "NotificationKind" ADD VALUE 'CARPOOL_FORMED';
ALTER TYPE "NotificationKind" ADD VALUE 'CARPOOL_CLOSED';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "carpoolId" TEXT;

-- CreateTable
CREATE TABLE "Carpool" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "status" "CarpoolStatus" NOT NULL DEFAULT 'OPEN',
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "pickupPoints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "seats" INTEGER NOT NULL,
    "minPassengers" INTEGER,
    "seatPriceMinor" INTEGER,
    "seatCurrency" "Currency" NOT NULL DEFAULT 'HKD',
    "luggagePerSeat" INTEGER,
    "cancelPolicy" TEXT,
    "notes" TEXT,
    "closesAt" TIMESTAMP(3) NOT NULL,
    "autoConfirm" BOOLEAN NOT NULL DEFAULT false,
    "waitMinutes" INTEGER NOT NULL DEFAULT 15,
    "showPaymentMethods" BOOLEAN NOT NULL DEFAULT false,
    "formedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Carpool_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CarpoolSeat" (
    "id" TEXT NOT NULL,
    "carpoolId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "CarpoolSeatStatus" NOT NULL DEFAULT 'PENDING',
    "passengers" INTEGER NOT NULL,
    "luggage" INTEGER NOT NULL DEFAULT 0,
    "pickupPoint" TEXT NOT NULL,
    "dropoff" TEXT,
    "passengerName" TEXT NOT NULL,
    "passengerContact" TEXT NOT NULL,
    "passengerWechat" TEXT,
    "notes" TEXT,
    "ip" TEXT,
    "expiresAt" TIMESTAMP(3),
    "reconfirmAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "noShowAt" TIMESTAMP(3),
    "droppedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "driverUnread" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CarpoolSeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Carpool_code_key" ON "Carpool"("code");

-- CreateIndex
CREATE UNIQUE INDEX "Carpool_orderId_key" ON "Carpool"("orderId");

-- CreateIndex
CREATE INDEX "Carpool_driverId_createdAt_idx" ON "Carpool"("driverId", "createdAt");

-- CreateIndex
CREATE INDEX "Carpool_status_closesAt_idx" ON "Carpool"("status", "closesAt");

-- CreateIndex
CREATE UNIQUE INDEX "CarpoolSeat_code_key" ON "CarpoolSeat"("code");

-- CreateIndex
CREATE INDEX "CarpoolSeat_carpoolId_status_idx" ON "CarpoolSeat"("carpoolId", "status");

-- CreateIndex
CREATE INDEX "CarpoolSeat_ip_createdAt_idx" ON "CarpoolSeat"("ip", "createdAt");

-- AddForeignKey
ALTER TABLE "Carpool" ADD CONSTRAINT "Carpool_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Carpool" ADD CONSTRAINT "Carpool_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CarpoolSeat" ADD CONSTRAINT "CarpoolSeat_carpoolId_fkey" FOREIGN KEY ("carpoolId") REFERENCES "Carpool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
