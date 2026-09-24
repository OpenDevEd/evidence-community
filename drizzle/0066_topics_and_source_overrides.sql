CREATE TABLE "itemFieldOverride" (
	"itemKey" varchar(8) NOT NULL,
	"field" text NOT NULL,
	"value" jsonb,
	"sourceValue" jsonb,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"sourceVersion" text,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemFieldOverride_itemKey_field_pk" PRIMARY KEY("itemKey","field")
);
--> statement-breakpoint
CREATE TABLE "itemSourceValue" (
	"itemKey" varchar(8) NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"remoteVersion" text,
	"importedTopics" boolean DEFAULT false NOT NULL,
	"fetchedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemSourceValue_itemKey_sourceConnectionKey_pk" PRIMARY KEY("itemKey","sourceConnectionKey")
);
--> statement-breakpoint
CREATE TABLE "sourceTopicAssignment" (
	"itemKey" varchar(8) NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"topicId" text NOT NULL,
	"score" double precision NOT NULL,
	"primary" boolean NOT NULL,
	"sourceVersion" text,
	"fetchedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "sourceTopicAssignment_itemKey_sourceConnectionKey_topicId_pk" PRIMARY KEY("itemKey","sourceConnectionKey","topicId")
);
--> statement-breakpoint
CREATE TABLE "topicAssociationDelivery" (
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
CREATE TABLE "topicCatalogCache" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"payload" jsonb NOT NULL,
	"fetchedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "topicDeliveryConfiguration" (
	"key" text PRIMARY KEY NOT NULL,
	"signature" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "topics" varchar[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "itemFieldOverride" ADD CONSTRAINT "itemFieldOverride_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemFieldOverride" ADD CONSTRAINT "itemFieldOverride_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemSourceValue" ADD CONSTRAINT "itemSourceValue_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemSourceValue" ADD CONSTRAINT "itemSourceValue_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceTopicAssignment" ADD CONSTRAINT "sourceTopicAssignment_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceTopicAssignment" ADD CONSTRAINT "sourceTopicAssignment_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sourceTopicAssignment_topic_idx" ON "sourceTopicAssignment" USING btree ("topicId");--> statement-breakpoint
CREATE INDEX "topicAssociationDelivery_pending_idx" ON "topicAssociationDelivery" USING btree ("nextAttemptAt") WHERE "topicAssociationDelivery"."nextAttemptAt" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "topicCatalogCache_kind_idx" ON "topicCatalogCache" USING btree ("kind");
--> statement-breakpoint
ALTER TABLE "topicAssociationDelivery" ADD COLUMN "payload" jsonb;--> statement-breakpoint
ALTER TABLE "topicDeliveryConfiguration" ADD COLUMN "revisionAt" timestamp with time zone NOT NULL;--> statement-breakpoint
CREATE FUNCTION enqueue_topic_association_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."entityType" <> 'item' THEN RETURN NEW; END IF;
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
CREATE TRIGGER enqueue_topic_association_delivery AFTER INSERT ON "outbox"
FOR EACH ROW EXECUTE FUNCTION enqueue_topic_association_delivery();

--> statement-breakpoint
CREATE TABLE "sourceReference" (
	"sourceConnectionKey" varchar(64) NOT NULL,
	"itemKey" varchar(8) NOT NULL,
	"targetRecordKey" varchar(512) NOT NULL,
	CONSTRAINT "sourceReference_sourceConnectionKey_itemKey_targetRecordKey_pk" PRIMARY KEY("sourceConnectionKey","itemKey","targetRecordKey")
);
--> statement-breakpoint
ALTER TABLE "sourceReference" ADD CONSTRAINT "sourceReference_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceReference" ADD CONSTRAINT "sourceReference_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sourceReference_target_idx" ON "sourceReference" USING btree ("targetRecordKey");