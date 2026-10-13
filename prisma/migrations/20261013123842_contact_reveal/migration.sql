-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "contactRevealMinutes" INTEGER DEFAULT 60;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "contactRevealMinutes" INTEGER DEFAULT 60;
