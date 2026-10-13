-- CreateEnum
CREATE TYPE "SmsProviderKind" AS ENUM ('SMS253', 'SPUG');

-- AlterTable
ALTER TABLE "SmsChannel" ADD COLUMN     "provider" "SmsProviderKind" NOT NULL DEFAULT 'SMS253';

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "provider" "SmsProviderKind" NOT NULL DEFAULT 'SMS253';
