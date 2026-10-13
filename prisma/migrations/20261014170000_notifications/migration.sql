-- CreateEnum
CREATE TYPE "NotificationGroup" AS ENUM ('DISPATCHED', 'CLAIMED', 'BOOKINGS', 'SUPPORT');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('ORDER_CLAIMED', 'ORDER_CONFIRMED', 'ORDER_COMPLETED', 'ORDER_CANCELLED', 'ORDER_CANCELLED_BY_STAFF', 'ORDER_REOPENED', 'ORDER_SETTLED', 'CONTACT_REVEALED', 'BOOKING_NEW', 'BOOKING_ACCEPTED', 'BOOKING_CANCELLED', 'SUPPORT_REPLY');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationsOff" "NotificationGroup"[] DEFAULT ARRAY[]::"NotificationGroup"[];

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "orderId" TEXT,
    "bookingId" TEXT,
    "summary" TEXT NOT NULL DEFAULT '',
    "pickupAt" TIMESTAMP(3),
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_createdAt_idx" ON "Notification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_userId_dedupeKey_key" ON "Notification"("userId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

