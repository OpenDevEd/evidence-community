ALTER TABLE "publicationSyncState" DROP CONSTRAINT "publicationSyncState_provider_fields_valid";--> statement-breakpoint
ALTER TABLE "publicationTarget" DROP CONSTRAINT "publicationTarget_identifier_policy_valid";--> statement-breakpoint
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
					AND "publicationSyncState"."identifierPolicy" IN ('reuse-crossref', 'reuse-external', 'mint-zenodo')
					AND "publicationSyncState"."pendingStage" IS NULL
					AND "publicationSyncState"."pendingPayloadHash" IS NULL
					AND "publicationSyncState"."pendingPayloadSnapshot" IS NULL
					AND "publicationSyncState"."pendingBatchId" IS NULL
					AND "publicationSyncState"."pendingFilename" IS NULL
					AND "publicationSyncState"."pendingSubmittedAt" IS NULL
					AND "publicationSyncState"."pendingReason" IS NULL)
			));--> statement-breakpoint
ALTER TABLE "publicationTarget" ADD CONSTRAINT "publicationTarget_identifier_policy_valid" CHECK ((
				("publicationTarget"."provider" = 'crossref' AND "publicationTarget"."identifierPolicy" IS NULL)
				OR ("publicationTarget"."provider" = 'zenodo'
					AND "publicationTarget"."identifierPolicy" IS NOT NULL
					AND "publicationTarget"."identifierPolicy" IN ('reuse-crossref', 'reuse-external', 'mint-zenodo'))
			));