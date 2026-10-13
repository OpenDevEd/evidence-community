-- A meta-analysis or randomised trial says so in its title, abstract or PDF; without those words the AI is not offered
-- the type. Every such type the AI gave before this release is queued, and the reading cycle asks again, without the
-- type, each record whose words are missing. The others leave the queue unread.
-- Rollback: drizzle/rollback/0090_type-words.sql.
INSERT INTO "itemReadingQueue" ("itemKey", "revision")
SELECT r."itemKey", i.revision FROM "itemReading" r JOIN "item" i ON i.key = r."itemKey"
WHERE r."typedBy" = 'ai' AND r."studyType" IN ('meta-analysis', 'rct')
ON CONFLICT ("itemKey") DO UPDATE SET "nextAttemptAt" = now(), "attempts" = 0, "lastError" = NULL;
