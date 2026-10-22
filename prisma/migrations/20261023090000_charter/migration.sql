-- 包車（按小時計費）(2026-10-23): an order booked by the hour, with its hourly prices and
-- overtime rules as the dispatcher states them. The totals stay in the order's prices.
-- CreateEnum
CREATE TYPE "CharterExtra" AS ENUM ('TOLLS', 'PARKING', 'MEALS');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "charterExtras" "CharterExtra"[] DEFAULT ARRAY[]::"CharterExtra"[],
ADD COLUMN     "charterMinutes" INTEGER,
ADD COLUMN     "driverHourlyMinor" INTEGER,
ADD COLUMN     "overtimeDriverHourlyMinor" INTEGER,
ADD COLUMN     "overtimeGraceMinutes" INTEGER,
ADD COLUMN     "overtimePassengerHourlyMinor" INTEGER,
ADD COLUMN     "overtimeUnitMinutes" INTEGER,
ADD COLUMN     "passengerHourlyMinor" INTEGER;
