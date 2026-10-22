-- App 意向問卷 (2026-10-23): asked once in the driver app whether drivers want a WeChat mini
-- program or an app; the switch lives in 一般設定, each driver's answer is kept as given.
-- CreateEnum
CREATE TYPE "AppInterestChoice" AS ENUM ('MINIPROGRAM', 'IOS_APP', 'ANDROID_APP', 'WEB_ENOUGH');

-- CreateTable
CREATE TABLE "AppInterestSurvey" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "AppInterestSurvey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppInterestAnswer" (
    "userId" TEXT NOT NULL,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "choices" "AppInterestChoice"[] DEFAULT ARRAY[]::"AppInterestChoice"[],
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AppInterestAnswer_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "AppInterestAnswer_createdAt_idx" ON "AppInterestAnswer"("createdAt");

-- AddForeignKey
ALTER TABLE "AppInterestAnswer" ADD CONSTRAINT "AppInterestAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
