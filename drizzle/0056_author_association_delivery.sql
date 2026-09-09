CREATE TABLE "authorAssociationDelivery" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"revision" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone DEFAULT now(),
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"lastError" text
);
--> statement-breakpoint
CREATE INDEX "authorAssociationDelivery_pending_idx" ON "authorAssociationDelivery" USING btree ("nextAttemptAt") WHERE "authorAssociationDelivery"."nextAttemptAt" IS NOT NULL;
--> statement-breakpoint
CREATE FUNCTION enqueue_author_association_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."entityType" <> 'item' THEN RETURN NEW; END IF;
  IF NOT EXISTS (SELECT 1 FROM "authorAssociationDelivery" WHERE "itemKey" = NEW."entityKey")
    AND NOT EXISTS (
      SELECT 1 FROM "item", jsonb_array_elements(COALESCE("creators", '[]'::jsonb)) creator
      WHERE "key" = NEW."entityKey" AND creator->>'authorProfileId' IS NOT NULL
    ) THEN RETURN NEW;
  END IF;
  INSERT INTO "authorAssociationDelivery" ("itemKey", "revision") VALUES (NEW."entityKey", NEW."revision")
  ON CONFLICT ("itemKey") DO UPDATE SET
    "revision" = EXCLUDED."revision", "attempts" = 0, "nextAttemptAt" = now(),
    "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL
  WHERE "authorAssociationDelivery"."revision" < EXCLUDED."revision";
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER enqueue_author_association_delivery AFTER INSERT ON "outbox"
FOR EACH ROW EXECUTE FUNCTION enqueue_author_association_delivery();
