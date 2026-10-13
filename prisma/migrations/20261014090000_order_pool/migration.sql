-- AlterTable
ALTER TABLE "User" ADD COLUMN     "poolByDefault" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "inPool" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Order_inPool_status_pickupAt_idx" ON "Order"("inPool", "status", "pickupAt");
