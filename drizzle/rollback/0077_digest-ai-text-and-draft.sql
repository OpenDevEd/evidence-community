-- Rollback for 0077_digest-ai-text-and-draft. The runtime before it ignores
-- both columns and still writes every unpublished edition, so rolling the
-- release back needs no schema change. A published digest that was waiting to
-- be rewritten then stays as it is. Dropping the columns loses the text AI
-- wrote for each digest and any rewrite that was not published.
DROP INDEX "notificationEdition_pending_idx";--> statement-breakpoint
CREATE INDEX "notificationEdition_pending_idx" ON "notificationEdition" USING btree ("nextAttemptAt") WHERE "notificationEdition"."publishedAt" IS NULL;--> statement-breakpoint
ALTER TABLE "notificationEdition" DROP COLUMN "ai";--> statement-breakpoint
ALTER TABLE "notificationEdition" DROP COLUMN "draft";
