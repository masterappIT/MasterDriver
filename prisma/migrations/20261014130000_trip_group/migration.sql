-- CreateEnum
CREATE TYPE "TripGroupPlatform" AS ENUM ('WHATSAPP', 'WECHAT');

-- CreateTable
CREATE TABLE "TripGroup" (
    "orderId" TEXT NOT NULL,
    "platform" "TripGroupPlatform" NOT NULL,
    "inviteUrl" TEXT,
    "qrImage" BYTEA,
    "qrMime" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TripGroup_pkey" PRIMARY KEY ("orderId")
);

-- AddForeignKey
ALTER TABLE "TripGroup" ADD CONSTRAINT "TripGroup_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
