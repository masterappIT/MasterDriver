-- 特價車 bookings get limits of their own (2026-10-22), counted apart from 名片頁 requests: by
-- passenger phone, with a wide limit by address only against floods, and by driver.
-- AlterTable
ALTER TABLE "LimitSetting" ADD COLUMN     "dealBookingPerDriverPerDay" INTEGER NOT NULL DEFAULT 200,
ADD COLUMN     "dealBookingPerIpPerDay" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "dealBookingPerPhonePerDay" INTEGER NOT NULL DEFAULT 5;
