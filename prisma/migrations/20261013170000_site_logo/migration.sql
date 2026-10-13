-- CreateTable
CREATE TABLE "SiteLogo" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "mime" TEXT NOT NULL,
    "image" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "SiteLogo_pkey" PRIMARY KEY ("id")
);
