-- 名片頁 bookings: the passenger may ask for 接駁 (中途換車) instead of 直達 (2026-10-15).
ALTER TABLE "BookingRequest" ADD COLUMN "transfer" BOOLEAN NOT NULL DEFAULT false;
