-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "hidePlates" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "hkMacauPhone" TEXT,
ADD COLUMN     "mainlandPhone" TEXT;
