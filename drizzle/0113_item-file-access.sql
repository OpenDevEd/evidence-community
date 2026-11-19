-- Who may get a record's files, here and on Zenodo (Openscholar-ai/evidence-community#904). Null leaves it to the
-- licence: anyone under an open licence, nobody but editors under one that isn't. A record already deposited on Zenodo
-- under a licence that isn't open had its files public there and here, and keeps them so (`asDeposited`) until an
-- editor chooses otherwise. A licence of a record's own saved before it said whether it is open counts as open
-- (`recordLicenceSchema`), so none is rewritten.
-- Rollback: drizzle/rollback/0113_item-file-access.sql.
ALTER TABLE "item" ADD COLUMN "fileAccess" jsonb;
--> statement-breakpoint
UPDATE "item" SET "fileAccess" = '{"mode": "open", "asDeposited": true}'::jsonb
WHERE "fileAccess" IS NULL
	AND "licence"->>'kind' = 'zenodo'
	AND "licence"->>'id' IN ('other-closed', 'zenodo-freetoread-1.0')
	AND EXISTS (SELECT 1 FROM "publicationSyncState" WHERE "itemKey" = "item"."key" AND "provider" = 'zenodo');
