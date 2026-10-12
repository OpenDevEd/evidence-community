-- Rollback for 0086_record-screening. The runtime before it reads and grades but hides nothing. Dropping the columns
-- loses the pending grades of a subject change under way and which records were screened out; the grades stay.
CREATE OR REPLACE FUNCTION enqueue_item_reading() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."entityType" <> 'item' OR NEW."operation" = 'delete' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "item" WHERE key = NEW."entityKey" AND "parentItem" IS NULL) THEN RETURN NEW; END IF;
  INSERT INTO "itemReadingQueue" ("itemKey", "revision") VALUES (NEW."entityKey", NEW."revision")
  ON CONFLICT ("itemKey") DO UPDATE SET
    "revision" = EXCLUDED."revision", "generation" = "itemReadingQueue"."generation" + 1,
    "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
  WHERE "itemReadingQueue"."revision" < EXCLUDED."revision";
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION enqueue_item_reading_for_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision bigint;
BEGIN
  -- A source that no longer holds the record drops its grade of it.
  IF NEW."remoteDeleted" THEN
    DELETE FROM "itemGrade" WHERE "itemKey" = NEW."itemKey" AND "sourceConnectionKey" = NEW."sourceConnectionKey";
    RETURN NEW;
  END IF;
  -- An update that leaves the link active queues nothing.
  IF TG_OP = 'UPDATE' AND NOT OLD."remoteDeleted" THEN RETURN NEW; END IF;
  SELECT i.revision INTO revision FROM "item" i WHERE i.key = NEW."itemKey" AND i."parentItem" IS NULL;
  IF revision IS NULL THEN RETURN NEW; END IF;
  INSERT INTO "itemReadingQueue" ("itemKey", "revision") VALUES (NEW."itemKey", revision)
  ON CONFLICT ("itemKey") DO UPDATE SET
    "generation" = "itemReadingQueue"."generation" + 1,
    "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TABLE "sourceScreening";--> statement-breakpoint
DROP INDEX "itemGrade_pending_idx";--> statement-breakpoint
ALTER TABLE "itemReadingQueue" DROP COLUMN "requested";--> statement-breakpoint
ALTER TABLE "itemReading" DROP COLUMN "screenedOut";--> statement-breakpoint
ALTER TABLE "itemGrade" DROP COLUMN "pendingSubjectHash";--> statement-breakpoint
ALTER TABLE "itemGrade" DROP COLUMN "pendingGrade";--> statement-breakpoint
ALTER TABLE "itemGrade" DROP COLUMN "pendingScore";--> statement-breakpoint
ALTER TABLE "itemGrade" DROP COLUMN "grade";
