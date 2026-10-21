-- 更新說明彈窗 (2026-10-21): a picture shown once to every driver, uploaded in 一般設定;
-- each user keeps the version they closed.
-- AlterTable
ALTER TABLE "User" ADD COLUMN "updateNoticeSeen" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "UpdateNotice" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "hantMime" TEXT,
    "hantImage" BYTEA,
    "hansMime" TEXT,
    "hansImage" BYTEA,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "UpdateNotice_pkey" PRIMARY KEY ("id")
);
