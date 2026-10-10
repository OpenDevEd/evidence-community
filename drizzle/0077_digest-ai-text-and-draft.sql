-- An edition keeps the text AI wrote beside the text readers see, and can hold
-- a draft that nobody has published yet. Whether an edition waits to be written
-- is told by "nextAttemptAt" alone, so a digest readers already have can be
-- rewritten without being taken down first.
ALTER TABLE "notificationEdition" ADD COLUMN "ai" jsonb;--> statement-breakpoint
ALTER TABLE "notificationEdition" ADD COLUMN "draft" jsonb;--> statement-breakpoint
-- Every digest published so far was written by AI and never edited.
UPDATE "notificationEdition" SET "ai" = jsonb_build_object('title', "title", 'summary', "summary", 'markdown', "markdown")
  WHERE "stream" = 'digest' AND "publishedAt" IS NOT NULL AND "markdown" IS NOT NULL;--> statement-breakpoint
-- A published edition is not waiting to be written.
UPDATE "notificationEdition" SET "nextAttemptAt" = NULL WHERE "publishedAt" IS NOT NULL AND "nextAttemptAt" IS NOT NULL;--> statement-breakpoint
DROP INDEX "notificationEdition_pending_idx";--> statement-breakpoint
CREATE INDEX "notificationEdition_pending_idx" ON "notificationEdition" USING btree ("nextAttemptAt") WHERE "notificationEdition"."nextAttemptAt" IS NOT NULL;
