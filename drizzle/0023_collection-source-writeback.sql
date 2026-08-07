CREATE TABLE "collectionSourceLink" (
	"collectionKey" varchar(8) NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"sourceRecordKey" varchar(512) NOT NULL,
	"remoteVersion" varchar(255),
	"remoteDeleted" boolean DEFAULT false NOT NULL,
	"lastAcknowledgedRemoteVersion" varchar(255),
	"dirtyFields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"writebackEnabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collectionSourceLink_collectionKey_sourceConnectionKey_pk" PRIMARY KEY("collectionKey","sourceConnectionKey"),
	CONSTRAINT "collectionSourceLink_source_record_unique" UNIQUE("sourceConnectionKey","sourceRecordKey"),
	CONSTRAINT "collectionSourceLink_remote_only" CHECK ("collectionSourceLink"."sourceConnectionKey" <> 'native'),
	CONSTRAINT "collectionSourceLink_dirty_fields_array" CHECK (jsonb_typeof("collectionSourceLink"."dirtyFields") = 'array')
);
--> statement-breakpoint
CREATE TABLE "collectionSourceSnapshot" (
	"collectionKey" varchar(8) NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"payload" jsonb NOT NULL,
	"remoteVersion" varchar(255),
	"payloadHash" varchar(64) NOT NULL,
	"mappingProfileVersion" varchar(64),
	"fetchedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "collectionSourceSnapshot_collectionKey_sourceConnectionKey_pk" PRIMARY KEY("collectionKey","sourceConnectionKey")
);
--> statement-breakpoint
ALTER TABLE "sourceWritebackJob" DROP CONSTRAINT "sourceWritebackJob_revision_unique";--> statement-breakpoint
ALTER TABLE "sourceWritebackJob" DROP CONSTRAINT "sourceWritebackJob_link_fk";
--> statement-breakpoint
DROP INDEX "sourceWritebackJob_link_idx";--> statement-breakpoint
ALTER TABLE "sourceWritebackJob" ALTER COLUMN "itemKey" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceWritebackJob" ADD COLUMN "collectionKey" varchar(8);--> statement-breakpoint
ALTER TABLE "collectionSourceLink" ADD CONSTRAINT "collectionSourceLink_collectionKey_collectionIdentity_key_fk" FOREIGN KEY ("collectionKey") REFERENCES "public"."collectionIdentity"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collectionSourceLink" ADD CONSTRAINT "collectionSourceLink_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "collectionSourceSnapshot" ADD CONSTRAINT "collectionSourceSnapshot_collection_source_link_fk" FOREIGN KEY ("collectionKey","sourceConnectionKey") REFERENCES "public"."collectionSourceLink"("collectionKey","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collectionSourceLink_one_writeback_per_collection" ON "collectionSourceLink" USING btree ("collectionKey") WHERE "collectionSourceLink"."writebackEnabled" = true;--> statement-breakpoint
CREATE INDEX "collectionSourceLink_connection_idx" ON "collectionSourceLink" USING btree ("sourceConnectionKey");--> statement-breakpoint
INSERT INTO "collectionSourceLink" (
	"collectionKey",
	"sourceConnectionKey",
	"sourceRecordKey",
	"remoteDeleted",
	"writebackEnabled"
)
SELECT
	identity."key",
	identity."sourceConnectionKey",
	identity."sourceRecordKey",
	COALESCE(collection."deleted" = 1, false),
	true
FROM "collectionIdentity" AS identity
LEFT JOIN "collection" AS collection
	ON collection."key" = identity."key"
	AND collection."sourceConnectionKey" = identity."sourceConnectionKey"
WHERE identity."sourceConnectionKey" <> 'native'
ON CONFLICT ("collectionKey", "sourceConnectionKey") DO NOTHING;--> statement-breakpoint
ALTER TABLE "sourceWritebackJob" ADD CONSTRAINT "sourceWritebackJob_item_link_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."itemSourceLink"("itemKey","sourceConnectionKey") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sourceWritebackJob" ADD CONSTRAINT "sourceWritebackJob_collection_link_fk" FOREIGN KEY ("collectionKey","sourceConnectionKey") REFERENCES "public"."collectionSourceLink"("collectionKey","sourceConnectionKey") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "sourceWritebackJob_item_revision_unique" ON "sourceWritebackJob" USING btree ("itemKey","sourceConnectionKey","canonicalRevision","operation") WHERE "sourceWritebackJob"."itemKey" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "sourceWritebackJob_collection_revision_unique" ON "sourceWritebackJob" USING btree ("collectionKey","sourceConnectionKey","canonicalRevision","operation") WHERE "sourceWritebackJob"."collectionKey" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sourceWritebackJob_item_link_idx" ON "sourceWritebackJob" USING btree ("itemKey","sourceConnectionKey");--> statement-breakpoint
CREATE INDEX "sourceWritebackJob_collection_link_idx" ON "sourceWritebackJob" USING btree ("collectionKey","sourceConnectionKey");--> statement-breakpoint
ALTER TABLE "sourceWritebackJob" ADD CONSTRAINT "sourceWritebackJob_one_entity" CHECK (("sourceWritebackJob"."itemKey" IS NULL) <> ("sourceWritebackJob"."collectionKey" IS NULL));
