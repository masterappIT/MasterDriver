-- CreateTable
CREATE TABLE "ObservabilityRequestStat" (
    "day" DATE NOT NULL,
    "region" TEXT NOT NULL,
    "area" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "client" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "clientErrors" INTEGER NOT NULL DEFAULT 0,
    "slow" INTEGER NOT NULL DEFAULT 0,
    "totalMs" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObservabilityRequestStat_pkey" PRIMARY KEY ("day","region","area","source","client","category")
);

-- CreateTable
CREATE TABLE "ObservabilityInstance" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "presence" JSONB NOT NULL,
    "streams" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ObservabilityInstance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ObservabilityInstance_updatedAt_idx" ON "ObservabilityInstance"("updatedAt");

