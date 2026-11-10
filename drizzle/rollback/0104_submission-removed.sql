-- Rollback for 0104_submission-removed. An older runtime sends no "removed" and Openscholar's older contract refuses it,
-- so the trigger goes, and a delivery waiting with a payload built by this release is rebuilt, as a new generation, by
-- the older worker (which sends the paper as published).
DROP TRIGGER IF EXISTS "item_submission_status_on_delete" ON "item";
--> statement-breakpoint
DROP FUNCTION IF EXISTS enqueue_submission_status_on_delete();
--> statement-breakpoint
UPDATE "submissionStatusDelivery" SET "generation" = "generation" + 1, "payload" = NULL, "attempts" = 0,
  "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
WHERE "payload" ->> 'status' = 'removed';
