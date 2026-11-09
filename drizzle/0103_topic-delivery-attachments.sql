-- A change to a record's attachment (its PDF, the picture of its first page) sends the record to OpenScholar again, so
-- the PDF and cover its topic delivery carries stay current: a paper page shows them as soon as they exist.
CREATE OR REPLACE FUNCTION enqueue_topic_association_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent text;
BEGIN
  IF NEW."entityType" <> 'item' THEN RETURN NEW; END IF;
  SELECT "parentItem" INTO parent FROM "item" WHERE key = NEW."entityKey";
  IF parent IS NOT NULL THEN
    INSERT INTO "topicAssociationDelivery" ("itemKey", "revision")
      SELECT key, revision FROM "item" WHERE key = parent AND "parentItem" IS NULL
    ON CONFLICT ("itemKey") DO UPDATE SET
      "revision" = GREATEST("topicAssociationDelivery"."revision", EXCLUDED."revision"),
      "generation" = "topicAssociationDelivery"."generation" + 1,
      "payload" = NULL, "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "topicAssociationDelivery" WHERE "itemKey" = NEW."entityKey")
    AND NOT EXISTS (SELECT 1 FROM "item" WHERE key = NEW."entityKey" AND "parentItem" IS NULL) THEN RETURN NEW; END IF;
  INSERT INTO "topicAssociationDelivery" ("itemKey", "revision") VALUES (NEW."entityKey", NEW."revision")
  ON CONFLICT ("itemKey") DO UPDATE SET
    "revision" = EXCLUDED."revision", "generation" = "topicAssociationDelivery"."generation" + 1,
    "payload" = NULL, "attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
  WHERE "topicAssociationDelivery"."revision" < EXCLUDED."revision";
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Records already sent before this carry no PDF in OpenScholar: each one with a PDF is sent once more, with it.
UPDATE "topicAssociationDelivery" SET "generation" = "generation" + 1, "payload" = NULL, "attempts" = 0,
  "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
WHERE "itemKey" IN (SELECT "parentItem" FROM "item" WHERE "parentItem" IS NOT NULL AND lower("contentType") = 'application/pdf' AND coalesce("deleted", 0) <> 1);
