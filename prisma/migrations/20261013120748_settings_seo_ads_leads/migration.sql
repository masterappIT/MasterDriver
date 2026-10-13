-- CreateEnum
CREATE TYPE "SeoPage" AS ENUM ('HOME', 'PROFILE');

-- CreateEnum
CREATE TYPE "AdPosition" AS ENUM ('CLAIM_PAGE', 'HOME', 'MY_ORDERS');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'CONTACTED', 'INTERESTED', 'CONVERTED', 'NOT_INTERESTED');

-- CreateTable
CREATE TABLE "AppSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "upgradeUrl" TEXT NOT NULL DEFAULT '',
    "supportWechatId" TEXT NOT NULL DEFAULT '',
    "supportWhatsapp" TEXT NOT NULL DEFAULT '',
    "termsText" TEXT NOT NULL DEFAULT '',
    "privacyText" TEXT NOT NULL DEFAULT '',
    "announcementText" TEXT NOT NULL DEFAULT '',
    "announcementEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoSiteSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "canonicalOrigin" TEXT NOT NULL DEFAULT '',
    "googleVerification" TEXT NOT NULL DEFAULT '',
    "bingVerification" TEXT NOT NULL DEFAULT '',
    "baiduVerification" TEXT NOT NULL DEFAULT '',
    "baiduTongjiId" TEXT NOT NULL DEFAULT '',
    "allowIndexing" BOOLEAN NOT NULL DEFAULT false,
    "sitemapEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SeoSiteSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeoPageSetting" (
    "page" "SeoPage" NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT NOT NULL DEFAULT '',
    "shareImageUrl" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SeoPageSetting_pkey" PRIMARY KEY ("page")
);

-- CreateTable
CREATE TABLE "AdSlot" (
    "id" TEXT NOT NULL,
    "position" "AdPosition" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "imageUrl" TEXT NOT NULL DEFAULT '',
    "linkUrl" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdStat" (
    "adId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AdStat_pkey" PRIMARY KEY ("adId","day")
);

-- CreateTable
CREATE TABLE "Lead" (
    "userId" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "note" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "AdSlot_position_active_idx" ON "AdSlot"("position", "active");

-- AddForeignKey
ALTER TABLE "AdStat" ADD CONSTRAINT "AdStat_adId_fkey" FOREIGN KEY ("adId") REFERENCES "AdSlot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
