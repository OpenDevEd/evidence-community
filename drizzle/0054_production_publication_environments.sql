ALTER TABLE "doiNamespace" DROP CONSTRAINT "doiNamespace_environment_valid";--> statement-breakpoint
ALTER TABLE "publicationIdentifier" DROP CONSTRAINT "publicationIdentifier_provider_shape_valid";--> statement-breakpoint
ALTER TABLE "publicationSyncState" DROP CONSTRAINT "publicationSyncState_provider_fields_valid";--> statement-breakpoint
ALTER TABLE "publicationTarget" DROP CONSTRAINT "publicationTarget_provider_environment_valid";--> statement-breakpoint
ALTER TABLE "zenodoFileCorrectionApproval" DROP CONSTRAINT "zenodoFileCorrectionApproval_provider_environment_valid";--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" DROP CONSTRAINT "zenodoPublishJournal_provider_environment_valid";--> statement-breakpoint
ALTER TABLE "zenodoFileCorrectionApproval" ALTER COLUMN "environment" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ALTER COLUMN "environment" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "doiNamespace" ADD CONSTRAINT "doiNamespace_environment_valid" CHECK ("doiNamespace"."environment" IN ('test', 'production'));--> statement-breakpoint
ALTER TABLE "publicationIdentifier" ADD CONSTRAINT "publicationIdentifier_provider_shape_valid" CHECK ((
				("publicationIdentifier"."registrar" = 'crossref' AND "publicationIdentifier"."environment" IN ('test', 'production') AND "publicationIdentifier"."role" = 'primary')
				OR ("publicationIdentifier"."registrar" = 'zenodo' AND "publicationIdentifier"."environment" IN ('sandbox', 'production') AND "publicationIdentifier"."role" IN ('primary', 'version', 'concept'))
			));--> statement-breakpoint
ALTER TABLE "publicationSyncState" ADD CONSTRAINT "publicationSyncState_provider_fields_valid" CHECK ((
				("publicationSyncState"."provider" = 'crossref'
					AND "publicationSyncState"."environment" IN ('test', 'production')
					AND "publicationSyncState"."identifierPolicy" IS NULL
					AND "publicationSyncState"."lastFileManifestHash" IS NULL
					AND "publicationSyncState"."lastFileManifestSnapshot" IS NULL
					AND "publicationSyncState"."zenodoRecordId" IS NULL
                    AND "publicationSyncState"."unpublishedDraftDepositionId" IS NULL
					AND "publicationSyncState"."zenodoParentId" IS NULL
					AND "publicationSyncState"."zenodoVersionDoi" IS NULL
					AND "publicationSyncState"."zenodoConceptDoi" IS NULL
					AND "publicationSyncState"."zenodoFirstPublishedAt" IS NULL
					AND "publicationSyncState"."orphanDraftDepositionId" IS NULL)
				OR ("publicationSyncState"."provider" = 'zenodo'
					AND "publicationSyncState"."environment" IN ('sandbox', 'production')
					AND "publicationSyncState"."identifierPolicy" IS NOT NULL
					AND "publicationSyncState"."identifierPolicy" IN ('reuse-crossref', 'reuse-external', 'mint-zenodo')
					AND "publicationSyncState"."pendingStage" IS NULL
					AND "publicationSyncState"."pendingPayloadHash" IS NULL
					AND "publicationSyncState"."pendingPayloadSnapshot" IS NULL
					AND "publicationSyncState"."pendingBatchId" IS NULL
					AND "publicationSyncState"."pendingFilename" IS NULL
					AND "publicationSyncState"."pendingSubmittedAt" IS NULL
					AND "publicationSyncState"."pendingReason" IS NULL)
			));--> statement-breakpoint
ALTER TABLE "publicationTarget" ADD CONSTRAINT "publicationTarget_provider_environment_valid" CHECK ((
				("publicationTarget"."provider" = 'crossref' AND "publicationTarget"."environment" IN ('test', 'production'))
				OR ("publicationTarget"."provider" = 'zenodo' AND "publicationTarget"."environment" IN ('sandbox', 'production'))
			));--> statement-breakpoint
ALTER TABLE "zenodoFileCorrectionApproval" ADD CONSTRAINT "zenodoFileCorrectionApproval_provider_environment_valid" CHECK ("zenodoFileCorrectionApproval"."provider" = 'zenodo' AND "zenodoFileCorrectionApproval"."environment" IN ('sandbox', 'production'));--> statement-breakpoint
ALTER TABLE "zenodoPublishJournal" ADD CONSTRAINT "zenodoPublishJournal_provider_environment_valid" CHECK ("zenodoPublishJournal"."provider" = 'zenodo' AND "zenodoPublishJournal"."environment" IN ('sandbox', 'production'));