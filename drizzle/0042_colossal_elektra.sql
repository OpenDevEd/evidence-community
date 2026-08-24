ALTER TABLE "publicationTarget" ADD COLUMN "lockedExternalDoi" varchar(255);--> statement-breakpoint
ALTER TABLE "publicationTarget" ADD CONSTRAINT "publicationTarget_external_doi_valid" CHECK ((
				("publicationTarget"."provider" = 'zenodo'
					AND "publicationTarget"."identifierPolicy" = 'reuse-external'
					AND "publicationTarget"."lockedExternalDoi" ~ '^10\.[0-9]{4,9}/[^[:space:]]{1,200}$'
					AND "publicationTarget"."lockedExternalDoi" = lower("publicationTarget"."lockedExternalDoi"))
				OR (NOT ("publicationTarget"."provider" = 'zenodo' AND "publicationTarget"."identifierPolicy" = 'reuse-external')
					AND "publicationTarget"."lockedExternalDoi" IS NULL)
			));