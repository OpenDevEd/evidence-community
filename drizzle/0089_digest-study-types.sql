-- Digests list and count by study type (OpenDevEd/new-el#590). What OpenScholar read likely reviews as is no longer
-- kept: every record has a study type of its own now, from its reading or an editor.
-- Rollback: drizzle/rollback/0089_digest-study-types.sql.
DROP TABLE "notificationItemKind" CASCADE;--> statement-breakpoint
-- Each edition's publications by study type when its list is made. Editions listed before have none.
ALTER TABLE "notificationEdition" ADD COLUMN "studyTypes" jsonb;--> statement-breakpoint
-- Every digest's stored publications lose the old likely-review marks and take their record's study type now, so an
-- edition listed before keeps its reviews and syntheses as a list of their own. A record not read yet, or gone, has none.
UPDATE "notificationEdition" AS edition SET "publications" = (
	SELECT jsonb_agg(CASE WHEN typed.type IS NULL THEN stored.entry - 'candidate' - 'kind'
		ELSE (stored.entry - 'candidate' - 'kind') || jsonb_build_object('studyType', typed.type) END ORDER BY stored.position)
	FROM jsonb_array_elements(edition."publications") WITH ORDINALITY AS stored(entry, position)
	LEFT JOIN LATERAL (
		SELECT coalesce(item."studyType", reading."studyType") AS type
		FROM item LEFT JOIN "itemReading" reading ON reading."itemKey" = item.key
		WHERE item.key = stored.entry ->> 'key'
	) typed ON true
)
WHERE edition."stream" = 'digest' AND jsonb_array_length(edition."publications") > 0;
