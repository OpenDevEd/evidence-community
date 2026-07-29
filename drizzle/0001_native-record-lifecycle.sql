ALTER TYPE "public"."creatorType" ADD VALUE 'chair' BEFORE 'podcaster';--> statement-breakpoint
ALTER TYPE "public"."creatorType" ADD VALUE 'creator' BEFORE 'podcaster';--> statement-breakpoint
ALTER TYPE "public"."creatorType" ADD VALUE 'executiveProducer' BEFORE 'podcaster';--> statement-breakpoint
ALTER TYPE "public"."creatorType" ADD VALUE 'host' BEFORE 'podcaster';--> statement-breakpoint
ALTER TYPE "public"."creatorType" ADD VALUE 'narrator' BEFORE 'podcaster';--> statement-breakpoint
ALTER TYPE "public"."creatorType" ADD VALUE 'organizer' BEFORE 'podcaster';--> statement-breakpoint
ALTER TYPE "public"."creatorType" ADD VALUE 'originalCreator' BEFORE 'podcaster';--> statement-breakpoint
ALTER TYPE "public"."creatorType" ADD VALUE 'seriesCreator';--> statement-breakpoint
CREATE TABLE "collectionIdentity" (
	"key" varchar(8) PRIMARY KEY NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"sourceRecordKey" varchar(512) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collectionIdentity_source_record_unique" UNIQUE("sourceConnectionKey","sourceRecordKey"),
	CONSTRAINT "collectionIdentity_identity_unique" UNIQUE("key","sourceConnectionKey","sourceRecordKey"),
	CONSTRAINT "collectionIdentity_key_connection_unique" UNIQUE("key","sourceConnectionKey"),
	CONSTRAINT "collectionIdentity_key_format" CHECK ("collectionIdentity"."key" ~ '^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$'),
	CONSTRAINT "collectionIdentity_native_source_key_match" CHECK ("collectionIdentity"."sourceConnectionKey" <> 'native' OR "collectionIdentity"."sourceRecordKey" = "collectionIdentity"."key")
);
--> statement-breakpoint
CREATE TABLE "itemDraft" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"sourceConnectionKey" varchar(64) DEFAULT 'native' NOT NULL,
	"payload" jsonb NOT NULL,
	"baseRevision" bigint DEFAULT 0 NOT NULL,
	"draftRevision" bigint DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemDraft_native_only" CHECK ("itemDraft"."sourceConnectionKey" = 'native'),
	CONSTRAINT "itemDraft_payload_object" CHECK (jsonb_typeof("itemDraft"."payload") = 'object'),
	CONSTRAINT "itemDraft_revision_positive" CHECK ("itemDraft"."draftRevision" >= 1 AND "itemDraft"."baseRevision" >= 0)
);
--> statement-breakpoint
CREATE TABLE "itemIdentity" (
	"key" varchar(8) PRIMARY KEY NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"sourceRecordKey" varchar(512) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemIdentity_source_record_unique" UNIQUE("sourceConnectionKey","sourceRecordKey"),
	CONSTRAINT "itemIdentity_identity_unique" UNIQUE("key","sourceConnectionKey","sourceRecordKey"),
	CONSTRAINT "itemIdentity_key_connection_unique" UNIQUE("key","sourceConnectionKey"),
	CONSTRAINT "itemIdentity_key_format" CHECK ("itemIdentity"."key" ~ '^[23456789ABCDEFGHIJKLMNPQRSTUVWXYZ]{8}$'),
	CONSTRAINT "itemIdentity_native_source_key_match" CHECK ("itemIdentity"."sourceConnectionKey" <> 'native' OR "itemIdentity"."sourceRecordKey" = "itemIdentity"."key")
);
--> statement-breakpoint
DROP INDEX "collection_source_record_unique";--> statement-breakpoint
DROP INDEX "item_source_record_unique";--> statement-breakpoint
ALTER TABLE "item" ALTER COLUMN "creators" SET DATA TYPE jsonb USING to_jsonb("creators");--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "originalDate" varchar;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "eventPlace" varchar;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "originalPlace" varchar;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "sessionTitle" varchar;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "originalPublisher" varchar;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "PMCID" varchar;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "PMID" varchar;--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "priorityDate" varchar;--> statement-breakpoint
ALTER TABLE "collectionIdentity" ADD CONSTRAINT "collectionIdentity_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "itemDraft" ADD CONSTRAINT "itemDraft_identity_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."itemIdentity"("key","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemIdentity" ADD CONSTRAINT "itemIdentity_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_identity_fk" FOREIGN KEY ("key","sourceConnectionKey","sourceRecordKey") REFERENCES "public"."collectionIdentity"("key","sourceConnectionKey","sourceRecordKey") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_identity_fk" FOREIGN KEY ("key","sourceConnectionKey","sourceRecordKey") REFERENCES "public"."itemIdentity"("key","sourceConnectionKey","sourceRecordKey") ON DELETE no action ON UPDATE no action;
