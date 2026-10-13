-- CreateEnum
CREATE TYPE "PlateType" AS ENUM ('SINGLE', 'DUAL', 'TRIPLE');

-- AlterTable
ALTER TABLE "DriverProfile" ADD COLUMN     "plateType" "PlateType",
ADD COLUMN     "vehicleOwnership" "PlateRegion";
