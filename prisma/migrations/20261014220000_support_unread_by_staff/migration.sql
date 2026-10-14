-- 客服: what no staff member has opened yet, apart from what still needs a reply (2026-10-14).
ALTER TABLE "SupportConversation" ADD COLUMN "unreadByStaff" INTEGER NOT NULL DEFAULT 0;

-- Conversations waiting today: their messages since the last staff reply count as unread.
UPDATE "SupportConversation" c
SET "unreadByStaff" = (
  SELECT COUNT(*)
  FROM "SupportMessage" m
  WHERE m."conversationId" = c."id"
    AND m."fromStaff" = false
    AND m."seq" > COALESCE((SELECT MAX(s."seq") FROM "SupportMessage" s WHERE s."conversationId" = c."id" AND s."fromStaff" = true), 0)
)
WHERE c."waiting" = true;
