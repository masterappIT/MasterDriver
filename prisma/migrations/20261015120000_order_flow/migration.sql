-- 出單流程優化 (2026-10-15): 航班號, 先給常用司機, 行程進度, 修改行程待司機確認, 取消接單紀錄, 我的司機, and three notifications.
-- AlterEnum


ALTER TYPE "NotificationKind" ADD VALUE 'ORDER_UNCLAIMED';
ALTER TYPE "NotificationKind" ADD VALUE 'ORDER_CHANGED';
ALTER TYPE "NotificationKind" ADD VALUE 'ORDER_CHANGE_ACKED';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "arrivedAt" TIMESTAMP(3),
ADD COLUMN     "changePendingAt" TIMESTAMP(3),
ADD COLUMN     "changeSummary" TEXT,
ADD COLUMN     "departedAt" TIMESTAMP(3),
ADD COLUMN     "favoritesUntil" TIMESTAMP(3),
ADD COLUMN     "flightNo" TEXT,
ADD COLUMN     "pickedUpAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "OrderClaim" ADD COLUMN     "releasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DriverNote" (
    "ownerId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "favorite" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverNote_pkey" PRIMARY KEY ("ownerId","driverId")
);

-- CreateIndex
CREATE INDEX "DriverNote_driverId_idx" ON "DriverNote"("driverId");

-- AddForeignKey
ALTER TABLE "DriverNote" ADD CONSTRAINT "DriverNote_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverNote" ADD CONSTRAINT "DriverNote_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

