-- CreateEnum
CREATE TYPE "PlateRegion" AS ENUM ('HK', 'MACAU', 'MAINLAND');

-- AlterTable
ALTER TABLE "Order" DROP COLUMN "handoffNote",
ADD COLUMN     "requiredPlates" "PlateRegion"[] DEFAULT ARRAY[]::"PlateRegion"[];
