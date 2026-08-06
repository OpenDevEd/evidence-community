CREATE TABLE "itemSourceLink" (
	"itemKey" varchar(8) NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"sourceRecordKey" varchar(512) NOT NULL,
	"remoteVersion" varchar(255),
	"lastAcknowledgedRemoteVersion" varchar(255),
	"dirtyFields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"writebackEnabled" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemSourceLink_itemKey_sourceConnectionKey_pk" PRIMARY KEY("itemKey","sourceConnectionKey"),
	CONSTRAINT "itemSourceLink_source_record_unique" UNIQUE("sourceConnectionKey","sourceRecordKey"),
	CONSTRAINT "itemSourceLink_remote_only" CHECK ("itemSourceLink"."sourceConnectionKey" <> 'native'),
	CONSTRAINT "itemSourceLink_dirty_fields_array" CHECK (jsonb_typeof("itemSourceLink"."dirtyFields") = 'array')
);
--> statement-breakpoint
ALTER TABLE "itemSourceLink" ADD CONSTRAINT "itemSourceLink_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemSourceLink" ADD CONSTRAINT "itemSourceLink_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "itemSourceLink_one_writeback_per_item" ON "itemSourceLink" USING btree ("itemKey") WHERE "itemSourceLink"."writebackEnabled" = true;--> statement-breakpoint
CREATE INDEX "itemSourceLink_connection_idx" ON "itemSourceLink" USING btree ("sourceConnectionKey");--> statement-breakpoint
INSERT INTO "itemSourceLink" (
	"itemKey",
	"sourceConnectionKey",
	"sourceRecordKey",
	"remoteVersion",
	"lastAcknowledgedRemoteVersion",
	"createdAt",
	"updatedAt"
)
SELECT
	identity."key",
	identity."sourceConnectionKey",
	identity."sourceRecordKey",
	snapshot."remoteVersion",
	snapshot."remoteVersion",
	identity."createdAt",
	COALESCE(snapshot."fetchedAt", identity."createdAt")
FROM "itemIdentity" AS identity
LEFT JOIN "sourceSnapshot" AS snapshot
	ON snapshot."itemKey" = identity."key"
WHERE identity."sourceConnectionKey" <> 'native';--> statement-breakpoint
ALTER TABLE "sourceSnapshot" ADD COLUMN "sourceConnectionKey" varchar(64);--> statement-breakpoint
UPDATE "sourceSnapshot" AS snapshot
SET "sourceConnectionKey" = identity."sourceConnectionKey"
FROM "itemIdentity" AS identity
WHERE identity."key" = snapshot."itemKey"
	AND identity."sourceConnectionKey" <> 'native';--> statement-breakpoint
ALTER TABLE "sourceSnapshot" ALTER COLUMN "sourceConnectionKey" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceRecordAlias" DROP CONSTRAINT "sourceRecordAlias_item_source_fk";--> statement-breakpoint
ALTER TABLE "sourceSnapshot" DROP CONSTRAINT "sourceSnapshot_itemKey_item_key_fk";--> statement-breakpoint
ALTER TABLE "sourceSnapshot" DROP CONSTRAINT "sourceSnapshot_itemKey_pk";--> statement-breakpoint
ALTER TABLE "sourceSnapshot" ADD CONSTRAINT "sourceSnapshot_itemKey_sourceConnectionKey_pk" PRIMARY KEY("itemKey","sourceConnectionKey");--> statement-breakpoint
ALTER TABLE "sourceRecordAlias" ADD CONSTRAINT "sourceRecordAlias_item_source_link_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."itemSourceLink"("itemKey","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sourceSnapshot" ADD CONSTRAINT "sourceSnapshot_item_source_link_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."itemSourceLink"("itemKey","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;
