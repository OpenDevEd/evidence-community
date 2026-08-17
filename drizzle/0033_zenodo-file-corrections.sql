CREATE TABLE "zenodoFileCorrectionApproval" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zenodoFileCorrectionApproval_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itemKey" varchar(8) NOT NULL,
	"provider" text DEFAULT 'zenodo' NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"doi" varchar(255) NOT NULL,
	"fileManifestHash" varchar(64) NOT NULL,
	"approvedAt" timestamp with time zone NOT NULL,
	"consumedAt" timestamp with time zone,
	"supersededAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "zenodoFileCorrectionApproval_item_id_unique" UNIQUE("itemKey","id"),
	CONSTRAINT "zenodoFileCorrectionApproval_provider_environment_valid" CHECK ("zenodoFileCorrectionApproval"."provider" = 'zenodo' AND "zenodoFileCorrectionApproval"."environment" = 'sandbox'),
	CONSTRAINT "zenodoFileCorrectionApproval_doi_valid" CHECK ("zenodoFileCorrectionApproval"."doi" ~ '^10\.[0-9]{4,9}/[^[:space:]]{1,200}$' AND "zenodoFileCorrectionApproval"."doi" = lower("zenodoFileCorrectionApproval"."doi")),
	CONSTRAINT "zenodoFileCorrectionApproval_hash_valid" CHECK ("zenodoFileCorrectionApproval"."fileManifestHash" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "zenodoFileCorrectionApproval_terminal_state_valid" CHECK (num_nonnulls("zenodoFileCorrectionApproval"."consumedAt", "zenodoFileCorrectionApproval"."supersededAt") <= 1
				AND ("zenodoFileCorrectionApproval"."consumedAt" IS NULL OR "zenodoFileCorrectionApproval"."consumedAt" >= "zenodoFileCorrectionApproval"."approvedAt")
				AND ("zenodoFileCorrectionApproval"."supersededAt" IS NULL OR "zenodoFileCorrectionApproval"."supersededAt" >= "zenodoFileCorrectionApproval"."approvedAt"))
);
--> statement-breakpoint
ALTER TABLE "publicationSyncState" DROP CONSTRAINT "publicationSyncState_provider_fields_valid";--> statement-breakpoint
ALTER TABLE "publicationSyncState" ADD COLUMN "zenodoFirstPublishedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD COLUMN "fileCorrectionApprovalId" bigint;--> statement-breakpoint
ALTER TABLE "zenodoFileCorrectionApproval" ADD CONSTRAINT "zenodoFileCorrectionApproval_target_fk" FOREIGN KEY ("itemKey","provider","environment") REFERENCES "public"."publicationTarget"("itemKey","provider","environment") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "zenodoFileCorrectionApproval_active_item_unique" ON "zenodoFileCorrectionApproval" USING btree ("itemKey","provider","environment") WHERE "zenodoFileCorrectionApproval"."consumedAt" IS NULL AND "zenodoFileCorrectionApproval"."supersededAt" IS NULL;--> statement-breakpoint
CREATE INDEX "zenodoFileCorrectionApproval_item_status_idx" ON "zenodoFileCorrectionApproval" USING btree ("itemKey","approvedAt");--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD CONSTRAINT "zenodoPublishJournal_file_correction_approval_fk" FOREIGN KEY ("itemKey","fileCorrectionApprovalId") REFERENCES "public"."zenodoFileCorrectionApproval"("itemKey","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "zenodoPublishJournal_file_correction_approval_idx" ON "zenodoPublishJournal" USING btree ("fileCorrectionApprovalId");--> statement-breakpoint
ALTER TABLE "publicationSyncState" ADD CONSTRAINT "publicationSyncState_provider_fields_valid" CHECK ((
				("publicationSyncState"."provider" = 'crossref'
					AND "publicationSyncState"."environment" = 'test'
					AND "publicationSyncState"."identifierPolicy" IS NULL
					AND "publicationSyncState"."lastFileManifestHash" IS NULL
					AND "publicationSyncState"."lastFileManifestSnapshot" IS NULL
					AND "publicationSyncState"."zenodoRecordId" IS NULL
					AND "publicationSyncState"."zenodoParentId" IS NULL
					AND "publicationSyncState"."zenodoVersionDoi" IS NULL
					AND "publicationSyncState"."zenodoConceptDoi" IS NULL
					AND "publicationSyncState"."zenodoFirstPublishedAt" IS NULL
					AND "publicationSyncState"."orphanDraftDepositionId" IS NULL)
				OR ("publicationSyncState"."provider" = 'zenodo'
					AND "publicationSyncState"."environment" = 'sandbox'
					AND "publicationSyncState"."identifierPolicy" IS NOT NULL
					AND "publicationSyncState"."identifierPolicy" IN ('reuse-crossref', 'mint-zenodo')
					AND "publicationSyncState"."pendingStage" IS NULL
					AND "publicationSyncState"."pendingPayloadHash" IS NULL
					AND "publicationSyncState"."pendingPayloadSnapshot" IS NULL
					AND "publicationSyncState"."pendingBatchId" IS NULL
					AND "publicationSyncState"."pendingFilename" IS NULL
					AND "publicationSyncState"."pendingSubmittedAt" IS NULL
					AND "publicationSyncState"."pendingReason" IS NULL)
			));--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD CONSTRAINT "zenodoPublishJournal_file_correction_approval_valid" CHECK ((
				("zenodoPublishJournal"."operationType" = 'zenodo_file_update' AND "zenodoPublishJournal"."fileCorrectionApprovalId" IS NOT NULL)
				OR ("zenodoPublishJournal"."operationType" <> 'zenodo_file_update' AND "zenodoPublishJournal"."fileCorrectionApprovalId" IS NULL)
			));