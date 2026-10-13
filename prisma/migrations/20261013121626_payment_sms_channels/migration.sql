-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'ALIPAY_HK');

-- CreateEnum
CREATE TYPE "SmsRoute" AS ENUM ('DOMESTIC', 'INTERNATIONAL');

-- CreateTable
CREATE TABLE "PaymentChannel" (
    "id" TEXT NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "environment" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "publishableKey" TEXT,
    "secretKeyEnc" TEXT,
    "webhookSecretEnc" TEXT,
    "paymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gatewayUrl" TEXT,
    "partner" TEXT,
    "appId" TEXT,
    "privateKeyEnc" TEXT,
    "publicKeyEnc" TEXT,
    "notifyUrl" TEXT,
    "returnUrl" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PaymentChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SmsChannel" (
    "route" "SmsRoute" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "endpoint" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "passwordEnc" TEXT,
    "template" TEXT NOT NULL DEFAULT '',
    "testPhone" TEXT NOT NULL DEFAULT '',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SmsChannel_pkey" PRIMARY KEY ("route")
);

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "route" "SmsRoute" NOT NULL,
    "countryCode" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "providerCode" TEXT,
    "providerError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentChannel_provider_environment_key" ON "PaymentChannel"("provider", "environment");

-- CreateIndex
CREATE INDEX "SmsMessage_createdAt_idx" ON "SmsMessage"("createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_countryCode_phone_createdAt_idx" ON "SmsMessage"("countryCode", "phone", "createdAt");
