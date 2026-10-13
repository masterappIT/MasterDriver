-- CreateTable
CREATE TABLE "SpugSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "endpoint" TEXT NOT NULL DEFAULT 'https://push.spug.cc',
    "appName" TEXT NOT NULL DEFAULT '',
    "templateCodeEnc" TEXT,
    "testPhone" TEXT NOT NULL DEFAULT '',
    "lastTestedAt" TIMESTAMP(3),
    "lastTestStatus" TEXT,
    "lastTestMessage" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SpugSetting_pkey" PRIMARY KEY ("id")
);


-- Spug used to be set up on the route that chose it, in place of that route's 253 account.
-- Move the first such setting (the domestic route's, if both had one) into SpugSetting, with
-- its on/off state, and give that route a blank, switched-off 253 account. The route keeps
-- choosing Spug, so sign-in codes go out exactly as before.
INSERT INTO "SpugSetting" ("id", "enabled", "endpoint", "appName", "templateCodeEnc", "testPhone", "lastTestedAt", "lastTestStatus", "lastTestMessage", "updatedAt", "updatedBy")
SELECT 'default', "enabled", "endpoint", "account", "passwordEnc", "testPhone", "lastTestedAt", "lastTestStatus", "lastTestMessage", CURRENT_TIMESTAMP, "updatedBy"
FROM "SmsChannel"
WHERE "provider" = 'SPUG'
ORDER BY "route" ASC
LIMIT 1;

UPDATE "SmsChannel"
SET "enabled" = false,
    "endpoint" = CASE WHEN "route" = 'DOMESTIC' THEN 'https://smssh1.253.com' ELSE '' END,
    "account" = '',
    "passwordEnc" = NULL,
    "lastTestedAt" = NULL,
    "lastTestStatus" = NULL,
    "lastTestMessage" = NULL
WHERE "provider" = 'SPUG';
