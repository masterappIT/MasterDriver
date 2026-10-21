-- 出單者代確認 (2026-10-21): the dispatcher may confirm the trip for a passenger who did not press
-- the link; the driver, the passenger and the platform can tell it from the passenger's own.
-- AlterTable
ALTER TABLE "Order" ADD COLUMN "passengerConfirmedByDispatcher" BOOLEAN NOT NULL DEFAULT false;
