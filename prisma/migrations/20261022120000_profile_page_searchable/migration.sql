-- 讓搜尋引擎找到我 (2026-10-22): a driver may let search engines index their published 名片頁.
-- AlterTable
ALTER TABLE "ProfilePage" ADD COLUMN     "searchable" BOOLEAN NOT NULL DEFAULT false;
