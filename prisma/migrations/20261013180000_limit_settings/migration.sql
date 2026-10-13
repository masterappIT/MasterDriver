-- CreateTable
CREATE TABLE "LimitSetting" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "supportGuestMediaPerDay" INTEGER NOT NULL DEFAULT 10,
    "supportUserMediaPerDay" INTEGER NOT NULL DEFAULT 30,
    "supportMessagesPerMinute" INTEGER NOT NULL DEFAULT 20,
    "supportGuestConversationsPerIpPerDay" INTEGER NOT NULL DEFAULT 5,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "LimitSetting_pkey" PRIMARY KEY ("id")
);
