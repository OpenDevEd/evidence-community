ALTER TABLE "zenodoPublishJournal" DROP CONSTRAINT "zenodoPublishJournal_hashes_valid";--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD COLUMN "payloadSnapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD COLUMN "fileManifestSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD CONSTRAINT "zenodoPublishJournal_hashes_valid" CHECK ("zenodoPublishJournal"."payloadHash" ~ '^[0-9a-f]{64}$'
				AND (("zenodoPublishJournal"."fileManifestHash" IS NULL AND "zenodoPublishJournal"."fileManifestSnapshot" IS NULL)
					OR ("zenodoPublishJournal"."fileManifestHash" ~ '^[0-9a-f]{64}$' AND "zenodoPublishJournal"."fileManifestSnapshot" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "publicationSyncState" DROP CONSTRAINT "publicationSyncState_last_success_bundle_valid";--> statement-breakpoint
ALTER TABLE "publicationSyncState" ADD CONSTRAINT "publicationSyncState_last_success_bundle_valid" CHECK ((
				("publicationSyncState"."lastPayloadHash" IS NULL AND "publicationSyncState"."lastPayloadSnapshot" IS NULL)
				OR ("publicationSyncState"."lastPayloadHash" ~ '^[0-9a-f]{64}$' AND "publicationSyncState"."lastPayloadSnapshot" IS NOT NULL)
			));--> statement-breakpoint
ALTER TABLE "publicationSyncState" DROP CONSTRAINT "publicationSyncState_file_bundle_valid";--> statement-breakpoint
ALTER TABLE "publicationSyncState" ADD CONSTRAINT "publicationSyncState_file_bundle_valid" CHECK ((
				("publicationSyncState"."lastFileManifestHash" IS NULL AND "publicationSyncState"."lastFileManifestSnapshot" IS NULL)
				OR ("publicationSyncState"."lastFileManifestHash" ~ '^[0-9a-f]{64}$' AND "publicationSyncState"."lastFileManifestSnapshot" IS NOT NULL)
			));--> statement-breakpoint
ALTER TABLE "publicationIdentifier" DROP CONSTRAINT "publicationIdentifier_target_fk";--> statement-breakpoint
ALTER TABLE "publicationIdentifier" ADD CONSTRAINT "publicationIdentifier_target_fk" FOREIGN KEY ("itemKey","registrar","environment") REFERENCES "public"."publicationTarget"("itemKey","provider","environment") ON DELETE restrict ON UPDATE no action;
