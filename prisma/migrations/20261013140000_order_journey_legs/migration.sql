-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "handoffNote" TEXT,
ADD COLUMN     "journeyId" TEXT,
ADD COLUMN     "legIndex" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Order_journeyId_legIndex_key" ON "Order"("journeyId", "legIndex");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

