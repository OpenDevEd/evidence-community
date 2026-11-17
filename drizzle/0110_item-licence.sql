-- A record's own licence, which its DOI goes out under (OpenDevEd/new-el#889), in place of one licence for the whole
-- library. A record already deposited on Zenodo takes the licence its last deposit carried, so its next deposit keeps
-- it whatever the library's default becomes; every other record starts with none, and a new DOI waits for one.
-- Rollback: drizzle/rollback/0110_item-licence.sql.
ALTER TABLE "item" ADD COLUMN "licence" jsonb;
--> statement-breakpoint
UPDATE "item"
SET "licence" = jsonb_build_object('kind', 'zenodo', 'id', deposited."id")
FROM (
	SELECT DISTINCT ON ("itemKey") "itemKey", "lastPayloadSnapshot" #>> '{metadata,rights,0,id}' AS "id"
	FROM "publicationSyncState"
	WHERE "provider" = 'zenodo' AND "lastPayloadSnapshot" #>> '{metadata,rights,0,id}' IS NOT NULL
	ORDER BY "itemKey", "environment" = 'production' DESC
) AS deposited
WHERE deposited."itemKey" = "item"."key" AND "item"."licence" IS NULL;
