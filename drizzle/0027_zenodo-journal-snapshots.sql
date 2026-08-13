ALTER TABLE "zenodoPublishJournal" DROP CONSTRAINT "zenodoPublishJournal_hashes_valid";--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD COLUMN "payloadSnapshot" jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD COLUMN "fileManifestSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD CONSTRAINT "zenodoPublishJournal_hashes_valid" CHECK ("zenodoPublishJournal"."payloadHash" ~ '^[0-9a-f]{64}$'
				AND (("zenodoPublishJournal"."fileManifestHash" IS NULL AND "zenodoPublishJournal"."fileManifestSnapshot" IS NULL)
					OR ("zenodoPublishJournal"."fileManifestHash" ~ '^[0-9a-f]{64}$' AND "zenodoPublishJournal"."fileManifestSnapshot" IS NOT NULL)));