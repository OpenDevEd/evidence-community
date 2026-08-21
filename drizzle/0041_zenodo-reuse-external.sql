ALTER TABLE "publicationTarget" DROP CONSTRAINT "publicationTarget_identifier_policy_valid";--> statement-breakpoint
ALTER TABLE "publicationTarget" ADD CONSTRAINT "publicationTarget_identifier_policy_valid" CHECK ((
				("publicationTarget"."provider" = 'crossref' AND "publicationTarget"."identifierPolicy" IS NULL)
				OR ("publicationTarget"."provider" = 'zenodo'
					AND "publicationTarget"."identifierPolicy" IS NOT NULL
					AND "publicationTarget"."identifierPolicy" IN ('reuse-crossref', 'reuse-external', 'mint-zenodo'))
			));