CREATE TABLE "doiNamespace" (
	"environment" text PRIMARY KEY NOT NULL,
	"prefix" varchar(12) NOT NULL,
	"suffixNamespace" varchar(64) NOT NULL,
	"nextSequence" bigint DEFAULT 1 NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "doiNamespace_prefix_suffix_unique" UNIQUE("prefix","suffixNamespace"),
	CONSTRAINT "doiNamespace_environment_valid" CHECK ("doiNamespace"."environment" = 'test'),
	CONSTRAINT "doiNamespace_prefix_valid" CHECK ("doiNamespace"."prefix" ~ '^10\.[0-9]{4,9}$'),
	CONSTRAINT "doiNamespace_suffix_valid" CHECK ("doiNamespace"."suffixNamespace" ~ '^[a-z0-9][a-z0-9._-]*$'),
	CONSTRAINT "doiNamespace_next_sequence_positive" CHECK ("doiNamespace"."nextSequence" >= 1)
);
--> statement-breakpoint
CREATE TABLE "publicationIdentifier" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "publicationIdentifier_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itemKey" varchar(8) NOT NULL,
	"registrar" text NOT NULL,
	"environment" text NOT NULL,
	"role" text NOT NULL,
	"doi" varchar(255) NOT NULL,
	"ownership" text NOT NULL,
	"lifecycle" text NOT NULL,
	"isCurrent" boolean DEFAULT true NOT NULL,
	"reservedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"verifiedAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publicationIdentifier_provider_doi_unique" UNIQUE("registrar","environment","doi"),
	CONSTRAINT "publicationIdentifier_provider_shape_valid" CHECK ((
				("publicationIdentifier"."registrar" = 'crossref' AND "publicationIdentifier"."environment" = 'test' AND "publicationIdentifier"."role" = 'primary')
				OR ("publicationIdentifier"."registrar" = 'zenodo' AND "publicationIdentifier"."environment" = 'sandbox' AND "publicationIdentifier"."role" IN ('primary', 'version', 'concept'))
			)),
	CONSTRAINT "publicationIdentifier_doi_valid" CHECK ("publicationIdentifier"."doi" ~ '^10\.[0-9]{4,9}/[^[:space:]]{1,200}$' AND "publicationIdentifier"."doi" = lower("publicationIdentifier"."doi")),
	CONSTRAINT "publicationIdentifier_external_verified" CHECK ("publicationIdentifier"."ownership" <> 'external' OR "publicationIdentifier"."lifecycle" = 'verified'),
	CONSTRAINT "publicationIdentifier_ownership_valid" CHECK ("publicationIdentifier"."ownership" IN ('managed', 'external')),
	CONSTRAINT "publicationIdentifier_lifecycle_valid" CHECK ("publicationIdentifier"."lifecycle" IN ('reserved', 'verified')),
	CONSTRAINT "publicationIdentifier_verified_bundle_valid" CHECK ((
				("publicationIdentifier"."lifecycle" = 'reserved' AND "publicationIdentifier"."verifiedAt" IS NULL)
				OR ("publicationIdentifier"."lifecycle" = 'verified' AND "publicationIdentifier"."verifiedAt" IS NOT NULL)
			))
);
--> statement-breakpoint
CREATE TABLE "publicationSyncJob" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "publicationSyncJob_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itemKey" varchar(8) NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"canonicalRevision" bigint NOT NULL,
	"fileRevision" bigint,
	"reason" text NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leaseOwner" varchar(255),
	"leaseExpiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"processedAt" timestamp with time zone,
	"deadLetteredAt" timestamp with time zone,
	"supersededAt" timestamp with time zone,
	"resultReceipt" jsonb,
	CONSTRAINT "publicationSyncJob_idempotency_unique" UNIQUE("idempotencyKey"),
	CONSTRAINT "publicationSyncJob_revisions_positive" CHECK ("publicationSyncJob"."canonicalRevision" >= 1 AND ("publicationSyncJob"."fileRevision" IS NULL OR "publicationSyncJob"."fileRevision" >= 1)),
	CONSTRAINT "publicationSyncJob_attempts_nonnegative" CHECK ("publicationSyncJob"."attempts" >= 0),
	CONSTRAINT "publicationSyncJob_reason_valid" CHECK ("publicationSyncJob"."reason" IN ('manual_activation', 'manual_retry', 'record_changed', 'file_changed', 'nightly_reconciliation')),
	CONSTRAINT "publicationSyncJob_lease_bundle_valid" CHECK ((
				("publicationSyncJob"."leaseOwner" IS NULL AND "publicationSyncJob"."leaseExpiresAt" IS NULL)
				OR ("publicationSyncJob"."leaseOwner" IS NOT NULL AND "publicationSyncJob"."leaseExpiresAt" IS NOT NULL)
			)),
	CONSTRAINT "publicationSyncJob_terminal_state_valid" CHECK (num_nonnulls("publicationSyncJob"."processedAt", "publicationSyncJob"."deadLetteredAt", "publicationSyncJob"."supersededAt") <= 1
				AND (num_nonnulls("publicationSyncJob"."processedAt", "publicationSyncJob"."deadLetteredAt", "publicationSyncJob"."supersededAt") = 0
					OR ("publicationSyncJob"."leaseOwner" IS NULL AND "publicationSyncJob"."leaseExpiresAt" IS NULL))),
	CONSTRAINT "publicationSyncJob_receipt_bundle_valid" CHECK (("publicationSyncJob"."processedAt" IS NULL AND "publicationSyncJob"."resultReceipt" IS NULL)
				OR ("publicationSyncJob"."processedAt" IS NOT NULL AND "publicationSyncJob"."resultReceipt" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "publicationSyncRun" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"leaseOwner" varchar(255),
	"leaseExpiresAt" timestamp with time zone,
	"heartbeatAt" timestamp with time zone,
	"claimedJobs" integer DEFAULT 0 NOT NULL,
	"succeededJobs" integer DEFAULT 0 NOT NULL,
	"failedJobs" integer DEFAULT 0 NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"completedAt" timestamp with time zone,
	"result" jsonb,
	"failure" text,
	CONSTRAINT "publicationSyncRun_counts_valid" CHECK ("publicationSyncRun"."claimedJobs" >= 0 AND "publicationSyncRun"."succeededJobs" >= 0 AND "publicationSyncRun"."failedJobs" >= 0
				AND "publicationSyncRun"."succeededJobs" + "publicationSyncRun"."failedJobs" <= "publicationSyncRun"."claimedJobs"),
	CONSTRAINT "publicationSyncRun_trigger_valid" CHECK ("publicationSyncRun"."trigger" IN ('immediate', 'nightly', 'manual')),
	CONSTRAINT "publicationSyncRun_state_bundle_valid" CHECK ((
				("publicationSyncRun"."status" = 'running'
					AND "publicationSyncRun"."leaseOwner" IS NOT NULL
					AND "publicationSyncRun"."leaseExpiresAt" IS NOT NULL
					AND "publicationSyncRun"."heartbeatAt" IS NOT NULL
					AND "publicationSyncRun"."completedAt" IS NULL)
				OR ("publicationSyncRun"."status" IN ('succeeded', 'failed')
					AND "publicationSyncRun"."leaseOwner" IS NULL
					AND "publicationSyncRun"."leaseExpiresAt" IS NULL
					AND "publicationSyncRun"."completedAt" IS NOT NULL)
			)),
	CONSTRAINT "publicationSyncRun_failure_valid" CHECK (("publicationSyncRun"."status" = 'failed' AND "publicationSyncRun"."failure" IS NOT NULL)
				OR ("publicationSyncRun"."status" <> 'failed' AND "publicationSyncRun"."failure" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "publicationSyncState" (
	"itemKey" varchar(8) NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"identifierPolicy" text,
	"lastPayloadHash" varchar(64),
	"lastPayloadSnapshot" jsonb,
	"lastFileManifestHash" varchar(64),
	"lastFileManifestSnapshot" jsonb,
	"pendingStage" text,
	"pendingPayloadHash" varchar(64),
	"pendingPayloadSnapshot" jsonb,
	"pendingBatchId" varchar(255),
	"pendingFilename" varchar(255),
	"pendingSubmittedAt" timestamp with time zone,
	"pendingReason" text,
	"zenodoRecordId" varchar(255),
	"zenodoParentId" varchar(255),
	"zenodoVersionDoi" varchar(255),
	"zenodoConceptDoi" varchar(255),
	"orphanDraftDepositionId" varchar(255),
	"lastFailureClass" varchar(255),
	"lastFailureSummary" text,
	"consecutiveFailures" integer DEFAULT 0 NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publicationSyncState_itemKey_provider_environment_pk" PRIMARY KEY("itemKey","provider","environment"),
	CONSTRAINT "publicationSyncState_provider_fields_valid" CHECK ((
				("publicationSyncState"."provider" = 'crossref'
					AND "publicationSyncState"."environment" = 'test'
					AND "publicationSyncState"."identifierPolicy" IS NULL
					AND "publicationSyncState"."lastFileManifestHash" IS NULL
					AND "publicationSyncState"."lastFileManifestSnapshot" IS NULL
					AND "publicationSyncState"."zenodoRecordId" IS NULL
					AND "publicationSyncState"."zenodoParentId" IS NULL
					AND "publicationSyncState"."zenodoVersionDoi" IS NULL
					AND "publicationSyncState"."zenodoConceptDoi" IS NULL
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
			)),
	CONSTRAINT "publicationSyncState_last_success_bundle_valid" CHECK ((
				("publicationSyncState"."lastPayloadHash" IS NULL AND "publicationSyncState"."lastPayloadSnapshot" IS NULL)
				OR "publicationSyncState"."lastPayloadHash" ~ '^[0-9a-f]{64}$'
			)),
	CONSTRAINT "publicationSyncState_file_bundle_valid" CHECK ((
				("publicationSyncState"."lastFileManifestHash" IS NULL AND "publicationSyncState"."lastFileManifestSnapshot" IS NULL)
				OR "publicationSyncState"."lastFileManifestHash" ~ '^[0-9a-f]{64}$'
			)),
	CONSTRAINT "publicationSyncState_pending_bundle_valid" CHECK ((
				("publicationSyncState"."pendingStage" IS NULL
					AND "publicationSyncState"."pendingPayloadHash" IS NULL
					AND "publicationSyncState"."pendingPayloadSnapshot" IS NULL
					AND "publicationSyncState"."pendingBatchId" IS NULL
					AND "publicationSyncState"."pendingFilename" IS NULL
					AND "publicationSyncState"."pendingSubmittedAt" IS NULL
					AND "publicationSyncState"."pendingReason" IS NULL)
				OR ("publicationSyncState"."pendingStage" IS NOT NULL AND "publicationSyncState"."pendingPayloadHash" ~ '^[0-9a-f]{64}$')
			)),
	CONSTRAINT "publicationSyncState_zenodo_identifiers_bundle_valid" CHECK ((
				("publicationSyncState"."zenodoRecordId" IS NULL AND "publicationSyncState"."zenodoParentId" IS NULL)
				OR ("publicationSyncState"."zenodoRecordId" IS NOT NULL AND "publicationSyncState"."zenodoParentId" IS NOT NULL)
			)),
	CONSTRAINT "publicationSyncState_failure_bundle_valid" CHECK ((
				("publicationSyncState"."consecutiveFailures" = 0 AND "publicationSyncState"."lastFailureClass" IS NULL AND "publicationSyncState"."lastFailureSummary" IS NULL)
				OR ("publicationSyncState"."consecutiveFailures" > 0 AND "publicationSyncState"."lastFailureClass" IS NOT NULL AND "publicationSyncState"."lastFailureSummary" IS NOT NULL)
			))
);
--> statement-breakpoint
CREATE TABLE "publicationTarget" (
	"itemKey" varchar(8) NOT NULL,
	"provider" text NOT NULL,
	"environment" text NOT NULL,
	"identifierPolicy" text,
	"requestedBy" varchar(255) NOT NULL,
	"requestedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivatedAt" timestamp with time zone,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "publicationTarget_itemKey_provider_environment_pk" PRIMARY KEY("itemKey","provider","environment"),
	CONSTRAINT "publicationTarget_provider_environment_valid" CHECK ((
				("publicationTarget"."provider" = 'crossref' AND "publicationTarget"."environment" = 'test')
				OR ("publicationTarget"."provider" = 'zenodo' AND "publicationTarget"."environment" = 'sandbox')
			)),
	CONSTRAINT "publicationTarget_identifier_policy_valid" CHECK ((
				("publicationTarget"."provider" = 'crossref' AND "publicationTarget"."identifierPolicy" IS NULL)
				OR ("publicationTarget"."provider" = 'zenodo'
					AND "publicationTarget"."identifierPolicy" IS NOT NULL
					AND "publicationTarget"."identifierPolicy" IN ('reuse-crossref', 'mint-zenodo'))
			))
);
--> statement-breakpoint
CREATE TABLE "zenodoPublishJournal" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "zenodoPublishJournal_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itemKey" varchar(8) NOT NULL,
	"provider" text DEFAULT 'zenodo' NOT NULL,
	"environment" text DEFAULT 'sandbox' NOT NULL,
	"operationType" text NOT NULL,
	"payloadHash" varchar(64) NOT NULL,
	"fileManifestHash" varchar(64),
	"depositionId" varchar(255) NOT NULL,
	"draftRecordId" varchar(255) NOT NULL,
	"parentId" varchar(255),
	"status" text NOT NULL,
	"publishedRecordId" varchar(255),
	"identifiers" jsonb,
	"orphanDraftCleanupDepositionId" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"publishedAt" timestamp with time zone,
	CONSTRAINT "zenodoPublishJournal_deposition_unique" UNIQUE("environment","depositionId"),
	CONSTRAINT "zenodoPublishJournal_provider_environment_valid" CHECK ("zenodoPublishJournal"."provider" = 'zenodo' AND "zenodoPublishJournal"."environment" = 'sandbox'),
	CONSTRAINT "zenodoPublishJournal_hashes_valid" CHECK ("zenodoPublishJournal"."payloadHash" ~ '^[0-9a-f]{64}$' AND ("zenodoPublishJournal"."fileManifestHash" IS NULL OR "zenodoPublishJournal"."fileManifestHash" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "zenodoPublishJournal_operation_valid" CHECK ("zenodoPublishJournal"."operationType" IN ('zenodo_create', 'zenodo_metadata_update', 'zenodo_file_update', 'zenodo_new_version')),
	CONSTRAINT "zenodoPublishJournal_published_bundle_valid" CHECK ((
				("zenodoPublishJournal"."status" IN ('preparing', 'ready_to_publish')
					AND "zenodoPublishJournal"."publishedRecordId" IS NULL
					AND "zenodoPublishJournal"."identifiers" IS NULL
					AND "zenodoPublishJournal"."publishedAt" IS NULL)
				OR ("zenodoPublishJournal"."status" = 'published'
					AND "zenodoPublishJournal"."publishedRecordId" IS NOT NULL
					AND "zenodoPublishJournal"."identifiers" IS NOT NULL
					AND "zenodoPublishJournal"."publishedAt" IS NOT NULL)
			))
);
--> statement-breakpoint
ALTER TABLE "publicationIdentifier" ADD CONSTRAINT "publicationIdentifier_target_fk" FOREIGN KEY ("itemKey","registrar","environment") REFERENCES "public"."publicationTarget"("itemKey","provider","environment") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicationSyncJob" ADD CONSTRAINT "publicationSyncJob_target_fk" FOREIGN KEY ("itemKey","provider","environment") REFERENCES "public"."publicationTarget"("itemKey","provider","environment") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicationSyncState" ADD CONSTRAINT "publicationSyncState_target_fk" FOREIGN KEY ("itemKey","provider","environment") REFERENCES "public"."publicationTarget"("itemKey","provider","environment") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "publicationTarget" ADD CONSTRAINT "publicationTarget_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD CONSTRAINT "zenodoPublishJournal_target_fk" FOREIGN KEY ("itemKey","provider","environment") REFERENCES "public"."publicationTarget"("itemKey","provider","environment") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "publicationIdentifier_current_role_unique" ON "publicationIdentifier" USING btree ("itemKey","registrar","environment","role") WHERE "publicationIdentifier"."isCurrent" = true;--> statement-breakpoint
CREATE INDEX "publicationIdentifier_item_idx" ON "publicationIdentifier" USING btree ("itemKey");--> statement-breakpoint
CREATE INDEX "publicationSyncJob_ready_idx" ON "publicationSyncJob" USING btree ("nextAttemptAt","id") WHERE "publicationSyncJob"."processedAt" IS NULL AND "publicationSyncJob"."deadLetteredAt" IS NULL AND "publicationSyncJob"."supersededAt" IS NULL;--> statement-breakpoint
CREATE INDEX "publicationSyncJob_lease_expiry_idx" ON "publicationSyncJob" USING btree ("leaseExpiresAt") WHERE "publicationSyncJob"."leaseOwner" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "publicationSyncJob_item_created_idx" ON "publicationSyncJob" USING btree ("itemKey","createdAt");--> statement-breakpoint
CREATE INDEX "publicationSyncRun_status_started_idx" ON "publicationSyncRun" USING btree ("status","startedAt");--> statement-breakpoint
CREATE INDEX "publicationTarget_item_active_idx" ON "publicationTarget" USING btree ("itemKey") WHERE "publicationTarget"."deactivatedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "zenodoPublishJournal_item_status_idx" ON "zenodoPublishJournal" USING btree ("itemKey","status");