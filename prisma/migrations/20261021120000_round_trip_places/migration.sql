-- 往返 (2026-10-21): the way back may leave from and go to other places than the way there
-- reversed; a 名片頁 booking may say so. Empty means the way there reversed.
-- AlterTable
ALTER TABLE "BookingRequest" ADD COLUMN "returnOrigin" TEXT,
ADD COLUMN "returnDestination" TEXT;
