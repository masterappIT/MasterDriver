-- CreateEnum
CREATE TYPE "SupportMessageKind" AS ENUM ('TEXT', 'IMAGE', 'VIDEO');

-- CreateTable
CREATE TABLE "SupportConversation" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "guestTokenHash" TEXT,
    "guestIp" TEXT,
    "waiting" BOOLEAN NOT NULL DEFAULT false,
    "unreadByParticipant" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SupportConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "seq" SERIAL NOT NULL,
    "conversationId" TEXT NOT NULL,
    "fromStaff" BOOLEAN NOT NULL,
    "staffId" TEXT,
    "kind" "SupportMessageKind" NOT NULL DEFAULT 'TEXT',
    "text" TEXT NOT NULL DEFAULT '',
    "clientMessageId" TEXT NOT NULL,
    "mediaId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SupportMedia" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "kind" "SupportMessageKind" NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksum" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SupportMedia_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversation_userId_key" ON "SupportConversation"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportConversation_guestTokenHash_key" ON "SupportConversation"("guestTokenHash");

-- CreateIndex
CREATE INDEX "SupportConversation_waiting_lastMessageAt_idx" ON "SupportConversation"("waiting", "lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_lastMessageAt_idx" ON "SupportConversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "SupportConversation_guestIp_createdAt_idx" ON "SupportConversation"("guestIp", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_seq_key" ON "SupportMessage"("seq");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_mediaId_key" ON "SupportMessage"("mediaId");

-- CreateIndex
CREATE INDEX "SupportMessage_conversationId_seq_idx" ON "SupportMessage"("conversationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMessage_conversationId_fromStaff_clientMessageId_key" ON "SupportMessage"("conversationId", "fromStaff", "clientMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "SupportMedia_storageKey_key" ON "SupportMedia"("storageKey");

-- CreateIndex
CREATE INDEX "SupportMedia_conversationId_createdAt_idx" ON "SupportMedia"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "SupportMedia_expiresAt_deletedAt_idx" ON "SupportMedia"("expiresAt", "deletedAt");

-- AddForeignKey
ALTER TABLE "SupportConversation" ADD CONSTRAINT "SupportConversation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Administrator"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMessage" ADD CONSTRAINT "SupportMessage_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "SupportMedia"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SupportMedia" ADD CONSTRAINT "SupportMedia_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "SupportConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
