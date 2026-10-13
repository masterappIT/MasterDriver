-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('PENDING', 'QUOTED', 'ACCEPTED', 'ORDERED', 'DECLINED', 'CANCELLED');

-- AlterTable
ALTER TABLE "LimitSetting" ADD COLUMN     "bookingPerIpPerDay" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "bookingPerPagePerDay" INTEGER NOT NULL DEFAULT 30;

-- CreateTable
CREATE TABLE "ProfilePage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "intro" TEXT NOT NULL DEFAULT '',
    "routes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "regions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "wechatId" TEXT NOT NULL DEFAULT '',
    "whatsapp" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProfilePage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfilePhoto" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfilePhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BookingRequest" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'PENDING',
    "pickupAt" TIMESTAMP(3) NOT NULL,
    "origin" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "passengers" INTEGER NOT NULL,
    "luggage" INTEGER NOT NULL DEFAULT 0,
    "passengerName" TEXT,
    "passengerContact" TEXT NOT NULL,
    "notes" TEXT,
    "quoteMinor" INTEGER,
    "quoteCurrency" "Currency" NOT NULL DEFAULT 'HKD',
    "quoteNote" TEXT,
    "quotedAt" TIMESTAMP(3),
    "driverUnread" BOOLEAN NOT NULL DEFAULT true,
    "orderId" TEXT,
    "source" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BookingRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePage_userId_key" ON "ProfilePage"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePage_code_key" ON "ProfilePage"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ProfilePhoto_storageKey_key" ON "ProfilePhoto"("storageKey");

-- CreateIndex
CREATE INDEX "ProfilePhoto_pageId_createdAt_idx" ON "ProfilePhoto"("pageId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BookingRequest_code_key" ON "BookingRequest"("code");

-- CreateIndex
CREATE UNIQUE INDEX "BookingRequest_orderId_key" ON "BookingRequest"("orderId");

-- CreateIndex
CREATE INDEX "BookingRequest_pageId_createdAt_idx" ON "BookingRequest"("pageId", "createdAt");

-- CreateIndex
CREATE INDEX "BookingRequest_ip_createdAt_idx" ON "BookingRequest"("ip", "createdAt");

-- AddForeignKey
ALTER TABLE "ProfilePage" ADD CONSTRAINT "ProfilePage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfilePhoto" ADD CONSTRAINT "ProfilePhoto_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "ProfilePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_pageId_fkey" FOREIGN KEY ("pageId") REFERENCES "ProfilePage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BookingRequest" ADD CONSTRAINT "BookingRequest_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;
