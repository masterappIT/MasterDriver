-- 名片頁 bookings: an optional WeChat ID beside the phone, which is now required (2026-10-14).
ALTER TABLE "BookingRequest" ADD COLUMN "passengerWechat" TEXT;
