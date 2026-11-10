-- Each queue claims its next records in ("nextAttemptAt", "itemKey") order. Indexed on "nextAttemptAt" alone, a queue
-- whose records were all queued at once (a community re-sending every record) shares one time, so Postgres sorted the
-- whole queue for every claim: 485 ms a batch on TVET's 288,000. Indexed on both, a claim reads only what it takes.
-- Rebuilding holds each queue's table lock until the migration commits, so its writes wait: about 0.23 s for 365,000
-- queued rows, during an update that restarts the workers anyway. CONCURRENTLY isn't allowed in a migration's transaction.
DROP INDEX IF EXISTS "topicAssociationDelivery_pending_idx";
--> statement-breakpoint
CREATE INDEX "topicAssociationDelivery_pending_idx" ON "topicAssociationDelivery" ("nextAttemptAt", "itemKey") WHERE "nextAttemptAt" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "authorAssociationDelivery_pending_idx";
--> statement-breakpoint
CREATE INDEX "authorAssociationDelivery_pending_idx" ON "authorAssociationDelivery" ("nextAttemptAt", "itemKey") WHERE "nextAttemptAt" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "submissionStatusDelivery_pending_idx";
--> statement-breakpoint
CREATE INDEX "submissionStatusDelivery_pending_idx" ON "submissionStatusDelivery" ("nextAttemptAt", "itemKey") WHERE "nextAttemptAt" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "itemReadingQueue_pending_idx";
--> statement-breakpoint
CREATE INDEX "itemReadingQueue_pending_idx" ON "itemReadingQueue" ("nextAttemptAt", "itemKey") WHERE "nextAttemptAt" IS NOT NULL;
