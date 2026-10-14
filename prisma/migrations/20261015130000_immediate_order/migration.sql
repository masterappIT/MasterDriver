-- 即時單: an order put out to leave now (2026-10-15).
ALTER TABLE "Order" ADD COLUMN "immediate" BOOLEAN NOT NULL DEFAULT false;
