UPDATE "itemSourceLink" AS link
SET
	"writebackEnabled" = true,
	"updatedAt" = NOW()
FROM "itemIdentity" AS identity
WHERE
	identity."key" = link."itemKey"
	AND identity."sourceConnectionKey" <> 'native'
	AND identity."sourceConnectionKey" = link."sourceConnectionKey"
	AND NOT EXISTS (
		SELECT 1
		FROM "itemSourceLink" AS enabled
		WHERE
			enabled."itemKey" = link."itemKey"
			AND enabled."writebackEnabled" = true
	);
