CREATE TABLE "itemGrade" (
	"itemKey" varchar(8) NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"score" real NOT NULL,
	"subjectHash" text NOT NULL,
	"gradedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemGrade_itemKey_sourceConnectionKey_pk" PRIMARY KEY("itemKey","sourceConnectionKey")
);
--> statement-breakpoint
CREATE TABLE "itemReading" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"studyType" text NOT NULL,
	"typeConfidence" real NOT NULL,
	"typedBy" text NOT NULL,
	"pooled" real NOT NULL,
	"region" text NOT NULL,
	"effects" real NOT NULL,
	"input" text NOT NULL,
	"contentHash" text NOT NULL,
	"questionSet" integer NOT NULL,
	"model" text NOT NULL,
	"readAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itemReadingQueue" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"revision" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone DEFAULT now(),
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"lastError" text
);
--> statement-breakpoint
CREATE TABLE "readingSpend" (
	"day" text PRIMARY KEY NOT NULL,
	"reads" integer DEFAULT 0 NOT NULL,
	"usd" double precision DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itemGrade" ADD CONSTRAINT "itemGrade_itemKey_sourceConnectionKey_itemSourceLink_itemKey_sourceConnectionKey_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."itemSourceLink"("itemKey","sourceConnectionKey") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "itemReading" ADD CONSTRAINT "itemReading_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itemGrade_source_idx" ON "itemGrade" USING btree ("sourceConnectionKey");--> statement-breakpoint
CREATE INDEX "itemReadingQueue_pending_idx" ON "itemReadingQueue" USING btree ("nextAttemptAt") WHERE "itemReadingQueue"."nextAttemptAt" IS NOT NULL;
--> statement-breakpoint
-- A published change to a top-level record queues it to be read. The reading cycle skips one whose title, abstract,
-- subjects and question set are unchanged, so a change to anything else costs no call.
CREATE FUNCTION enqueue_item_reading() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER enqueue_item_reading AFTER INSERT ON "outbox"
FOR EACH ROW EXECUTE FUNCTION enqueue_item_reading();
--> statement-breakpoint
-- A source that starts holding a record it did not hold before, an overlapping search for one, writes no new revision.
-- The record is queued all the same, so the new source's grade is asked.
CREATE FUNCTION enqueue_item_reading_for_link() RETURNS trigger LANGUAGE plpgsql AS $$
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
CREATE TRIGGER enqueue_item_reading_for_link AFTER INSERT OR UPDATE OF "remoteDeleted" ON "itemSourceLink"
FOR EACH ROW EXECUTE FUNCTION enqueue_item_reading_for_link();
