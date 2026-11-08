-- Papers added to a community one at a time, by DOI or OpenAlex ID (OpenDevEd/new-el#773): the built-in Added papers
-- source and the list it keeps up to date. Rollback: drizzle/rollback/0099_added-papers.sql.
ALTER TABLE "sourceConnection" DROP CONSTRAINT "sourceConnection_scope_valid";--> statement-breakpoint
ALTER TABLE "sourceConnection" ADD CONSTRAINT "sourceConnection_scope_valid" CHECK ((
				("sourceConnection"."provider" = 'native' AND "sourceConnection"."key" = 'native' AND "sourceConnection"."scopeKind" = 'library' AND "sourceConnection"."externalScopeKey" IS NULL)
				OR ("sourceConnection"."provider" = 'added' AND "sourceConnection"."key" = 'added-papers' AND "sourceConnection"."scopeKind" = 'library' AND "sourceConnection"."externalScopeKey" IS NULL)
				OR ("sourceConnection"."provider" = 'zotero' AND "sourceConnection"."scopeKind" IN ('group', 'personal-library') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'mendeley' AND "sourceConnection"."scopeKind" IN ('group', 'personal-library') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'openalex' AND "sourceConnection"."scopeKind" = 'query' AND "sourceConnection"."externalScopeKey" IS NULL)
				OR ("sourceConnection"."provider" = 'openscholar' AND "sourceConnection"."scopeKind" = 'collection' AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'dspace' AND "sourceConnection"."scopeKind" IN ('repository', 'collection', 'oai-set') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
				OR ("sourceConnection"."provider" = 'eprints' AND "sourceConnection"."scopeKind" IN ('repository', 'oai-set') AND "sourceConnection"."externalScopeKey" IS NOT NULL)
			));--> statement-breakpoint
-- Every community has it from the start; its PDFs are on by default (OpenDevEd/new-el#776).
INSERT INTO "sourceConnection" ("key", "provider", "scopeKind", "displayName", "config")
VALUES ('added-papers', 'added', 'library', 'Added papers', '{"downloadPdfs": true}')
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
CREATE TABLE "addedPaper" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itemKey" varchar(64) NOT NULL,
	"openalexId" varchar(32),
	"doi" varchar(512),
	"state" text NOT NULL,
	"addedBy" varchar(128) NOT NULL,
	"addedByName" varchar(255),
	"requestId" varchar(128) NOT NULL,
	"addedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"acceptedAt" timestamp with time zone,
	CONSTRAINT "addedPaper_itemKey_unique" UNIQUE("itemKey"),
	CONSTRAINT "addedPaper_state_valid" CHECK ("addedPaper"."state" IN ('pending', 'accepted')),
	CONSTRAINT "addedPaper_identified" CHECK ("addedPaper"."openalexId" IS NOT NULL OR "addedPaper"."doi" IS NOT NULL)
);--> statement-breakpoint
ALTER TABLE "addedPaper" ADD CONSTRAINT "addedPaper_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "addedPaper_openalex_unique" ON "addedPaper" USING btree ("openalexId") WHERE "addedPaper"."openalexId" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "addedPaper_doi_unique" ON "addedPaper" USING btree ("doi") WHERE "addedPaper"."doi" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "addedPaper_request_idx" ON "addedPaper" USING btree ("requestId");--> statement-breakpoint
CREATE INDEX "addedPaper_unresolved_idx" ON "addedPaper" USING btree ("state") WHERE "addedPaper"."openalexId" IS NULL;
