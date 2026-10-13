-- CreateEnum
CREATE TYPE "GroupPlatform" AS ENUM ('WECHAT', 'WHATSAPP');

-- CreateTable
CREATE TABLE "GroupInvite" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "platform" "GroupPlatform" NOT NULL,
    "name" TEXT NOT NULL,
    "inviteUrl" TEXT,
    "qrImage" BYTEA,
    "qrMime" TEXT,
    "expiresAt" TIMESTAMP(3),
    "showOnClaimPage" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GroupInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GroupInvite_ownerId_idx" ON "GroupInvite"("ownerId");

-- AddForeignKey
ALTER TABLE "GroupInvite" ADD CONSTRAINT "GroupInvite_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
