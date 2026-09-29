-- Rollback: keep this constraint. It only admits OpenScholar collection sources,
-- which older runtimes never create. Restoring the old constraint only works
-- while no 'openscholar' sourceConnection row exists.
ALTER TABLE "sourceConnection" DROP CONSTRAINT "sourceConnection_scope_valid";--> statement-breakpoint
ALTER TABLE "sourceConnection" ADD CONSTRAINT "sourceConnection_scope_valid" CHECK ((
				("sourceConnection"."provider" = 'native' AND "sourceConnection"."key" = 'native' AND "sourceConnection"."scopeKind" = 'library' AND "sourceConnection"."externalScopeKey" IS NULL)
				OR ("sourceConnection"."provider" = 'zotero' AND "sourceConnection"."scopeKind" IN ('group', 'personal-library') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'mendeley' AND "sourceConnection"."scopeKind" IN ('group', 'personal-library') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'openalex' AND "sourceConnection"."scopeKind" = 'query' AND "sourceConnection"."externalScopeKey" IS NULL)
				OR ("sourceConnection"."provider" = 'openscholar' AND "sourceConnection"."scopeKind" = 'collection' AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'dspace' AND "sourceConnection"."scopeKind" IN ('repository', 'collection', 'oai-set') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'eprints' AND "sourceConnection"."scopeKind" IN ('repository', 'oai-set') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
			));