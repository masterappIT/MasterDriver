-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('WECHAT', 'ALIPAY', 'PAYME', 'FPS', 'BANK', 'OTHER');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "showPaymentMethods" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "PaymentMethod" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "kind" "PaymentKind" NOT NULL,
    "label" TEXT NOT NULL,
    "account" TEXT,
    "qrImage" BYTEA,
    "qrMime" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentMethod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PaymentMethod_ownerId_idx" ON "PaymentMethod"("ownerId");

-- AddForeignKey
ALTER TABLE "PaymentMethod" ADD CONSTRAINT "PaymentMethod_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
