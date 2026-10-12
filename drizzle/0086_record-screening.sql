CREATE TABLE "sourceScreening" (
	"sourceConnectionKey" varchar(64) PRIMARY KEY NOT NULL,
	"subjectHash" text NOT NULL,
	"keptOut" text[] NOT NULL,
	"gradingOf" integer
);
--> statement-breakpoint
-- A grade is its score's nearest point on the scale, as the worker rounds it.
ALTER TABLE "itemGrade" ADD COLUMN "grade" text;--> statement-breakpoint
UPDATE "itemGrade" SET "grade" = (ARRAY['not-about', 'passing', 'touches', 'about'])[least(3, greatest(0, round("score"::numeric)))::int + 1];--> statement-breakpoint
ALTER TABLE "itemGrade" ALTER COLUMN "grade" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "itemGrade" ADD COLUMN "pendingScore" real;--> statement-breakpoint
ALTER TABLE "itemGrade" ADD COLUMN "pendingGrade" text;--> statement-breakpoint
ALTER TABLE "itemGrade" ADD COLUMN "pendingSubjectHash" text;--> statement-breakpoint
ALTER TABLE "itemReading" ADD COLUMN "screenedOut" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceScreening" ADD CONSTRAINT "sourceScreening_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- A PDF's text arriving queues its record, so a type the abstract left uncertain is asked again from the PDF.
CREATE OR REPLACE FUNCTION enqueue_item_reading() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent varchar(8); pdf boolean;
BEGIN
  IF NEW."entityType" <> 'item' OR NEW."operation" = 'delete' THEN RETURN NEW; END IF;
  SELECT nullif(i."parentItem", ''), i."fullTextPDF" IS NOT NULL INTO parent, pdf FROM "item" i WHERE i.key = NEW."entityKey";
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF parent IS NOT NULL THEN
    IF pdf THEN
      INSERT INTO "itemReadingQueue" ("itemKey", "revision") SELECT p.key, p.revision FROM "item" p WHERE p.key = parent
      ON CONFLICT ("itemKey") DO UPDATE SET
        "generation" = "itemReadingQueue"."generation" + 1,
        "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL;
    END IF;
    RETURN NEW;
  END IF;
  INSERT INTO "itemReadingQueue" ("itemKey", "revision") VALUES (NEW."entityKey", NEW."revision")
  ON CONFLICT ("itemKey") DO UPDATE SET
    "revision" = EXCLUDED."revision", "generation" = "itemReadingQueue"."generation" + 1,
    "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
  WHERE "itemReadingQueue"."revision" < EXCLUDED."revision";
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- A withdrawn link queues its record too, so whether the record is screened out is decided again without that source.
CREATE OR REPLACE FUNCTION enqueue_item_reading_for_link() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE revision bigint;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD."remoteDeleted" = NEW."remoteDeleted" THEN RETURN NEW; END IF;
  -- A source that no longer holds the record drops its grade of it.
  IF NEW."remoteDeleted" THEN
    DELETE FROM "itemGrade" WHERE "itemKey" = NEW."itemKey" AND "sourceConnectionKey" = NEW."sourceConnectionKey";
  END IF;
  SELECT i.revision INTO revision FROM "item" i WHERE i.key = NEW."itemKey" AND coalesce(i."parentItem", '') = '';
  IF revision IS NULL THEN RETURN NEW; END IF;
  INSERT INTO "itemReadingQueue" ("itemKey", "revision") VALUES (NEW."itemKey", revision)
  ON CONFLICT ("itemKey") DO UPDATE SET
    "generation" = "itemReadingQueue"."generation" + 1,
    "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL;
  RETURN NEW;
END;
$$;
