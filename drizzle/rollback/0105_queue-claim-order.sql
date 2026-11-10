-- Rollback for 0105_queue-claim-order: back to indexes on "nextAttemptAt" alone.
DROP INDEX IF EXISTS "topicAssociationDelivery_pending_idx";
--> statement-breakpoint
CREATE INDEX "topicAssociationDelivery_pending_idx" ON "topicAssociationDelivery" ("nextAttemptAt") WHERE "nextAttemptAt" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "authorAssociationDelivery_pending_idx";
--> statement-breakpoint
CREATE INDEX "authorAssociationDelivery_pending_idx" ON "authorAssociationDelivery" ("nextAttemptAt") WHERE "nextAttemptAt" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "submissionStatusDelivery_pending_idx";
--> statement-breakpoint
CREATE INDEX "submissionStatusDelivery_pending_idx" ON "submissionStatusDelivery" ("nextAttemptAt") WHERE "nextAttemptAt" IS NOT NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "itemReadingQueue_pending_idx";
--> statement-breakpoint
CREATE INDEX "itemReadingQueue_pending_idx" ON "itemReadingQueue" ("nextAttemptAt") WHERE "nextAttemptAt" IS NOT NULL;
