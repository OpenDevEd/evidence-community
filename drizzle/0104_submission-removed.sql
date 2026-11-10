-- An added paper the community accepted, then unpublished or deleted, is "Removed by the community" for whoever sent it
-- on Openscholar, and published again when it's restored. The record can go by any path (the admin, a collection, its
-- source), so a trigger on its deleted flag queues the paper's status, as review changes do (0101).
CREATE OR REPLACE FUNCTION enqueue_submission_status_on_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "submissionStatusDelivery" ("itemKey", "revision")
    SELECT "itemKey", 0 FROM "addedPaper" WHERE "itemKey" = NEW.key
  ON CONFLICT ("itemKey") DO UPDATE SET "generation" = "submissionStatusDelivery"."generation" + 1, "payload" = NULL,
    "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "item_submission_status_on_delete" AFTER UPDATE OF "deleted" ON "item"
  FOR EACH ROW WHEN (OLD."deleted" IS DISTINCT FROM NEW."deleted") EXECUTE FUNCTION enqueue_submission_status_on_delete();
--> statement-breakpoint
-- Accepted papers already gone from the site before this told Openscholar nothing: each is sent once, as removed.
INSERT INTO "submissionStatusDelivery" ("itemKey", "revision")
  SELECT a."itemKey", 0 FROM "addedPaper" a JOIN "item" i ON i.key = a."itemKey" WHERE a.state = 'accepted' AND i.deleted = 1
ON CONFLICT ("itemKey") DO UPDATE SET "generation" = "submissionStatusDelivery"."generation" + 1, "payload" = NULL,
  "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL;
