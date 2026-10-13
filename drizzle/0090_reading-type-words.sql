-- Whether a meta-analysis or randomised trial call found its words in the record's title, abstract or PDF text; without
-- them the call is uncertain. Null for other types, and until checked. Existing calls of those two types are queued,
-- and the reading worker checks them without asking Jev.
-- Rollback: drizzle/rollback/0090_reading-type-words.sql.
ALTER TABLE "itemReading" ADD COLUMN "typeWords" boolean;
--> statement-breakpoint
-- A row already waiting keeps its turn; a finished one is due now. A lease in progress is left alone.
INSERT INTO "itemReadingQueue" ("itemKey", "revision")
SELECT r."itemKey", i.revision FROM "itemReading" r JOIN "item" i ON i.key = r."itemKey"
WHERE r."typedBy" = 'ai' AND r."studyType" IN ('meta-analysis', 'rct')
ON CONFLICT ("itemKey") DO UPDATE SET "nextAttemptAt" = coalesce("itemReadingQueue"."nextAttemptAt", now()), "attempts" = 0;
