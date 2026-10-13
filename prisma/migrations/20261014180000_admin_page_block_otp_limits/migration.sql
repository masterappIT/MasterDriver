-- AlterTable
ALTER TABLE "LimitSetting" ADD COLUMN     "otpPerIpPerHour" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "otpPerPhonePerHour" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "otpResendSeconds" INTEGER NOT NULL DEFAULT 60;

-- AlterTable
ALTER TABLE "ProfilePage" ADD COLUMN     "blockedAt" TIMESTAMP(3),
ADD COLUMN     "blockedReason" TEXT;

