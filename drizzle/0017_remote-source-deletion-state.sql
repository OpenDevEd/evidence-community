ALTER TABLE "itemSourceLink" ADD COLUMN "remoteDeleted" boolean DEFAULT false NOT NULL;

UPDATE "itemSourceLink" AS link
SET "remoteDeleted" = true
FROM "item" AS canonical
WHERE canonical."key" = link."itemKey"
	AND canonical."sourceConnectionKey" = link."sourceConnectionKey"
	AND canonical."deleted" = 1;
