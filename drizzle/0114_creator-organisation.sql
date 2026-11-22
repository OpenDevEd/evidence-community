-- An author an editor picked as an organisation says so (`"organization": true`), and every other author is a person
-- (OpenDevEd/evidence-community#927). Until now the creator card stored an organisation as a one-field name and nothing
-- more, while OpenAlex, Openscholar and Zotero keep a person's whole name in one field too, so the record's structured
-- data and the card had to guess. On a record made or imported in the admin, a one-field name came from the card's
-- Organisation choice, so it becomes an organisation, unless it's linked to an author profile, which is a person's.
-- Records from sources, and their drafts, keep their people. Pending and returned reviews are what an approval
-- publishes, so their native records are marked too.
-- Rollback: drizzle/rollback/0114_creator-organisation.sql.
CREATE FUNCTION "creators_marking_organisations"(creators jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT COALESCE(jsonb_agg(CASE
		WHEN jsonb_typeof(creator) = 'object'
			AND COALESCE(btrim(creator->>'name'), '') <> ''
			AND COALESCE(btrim(creator->>'firstName'), '') = ''
			AND COALESCE(btrim(creator->>'lastName'), '') = ''
			AND NOT creator ? 'authorProfileId'
		THEN creator || '{"organization": true}'::jsonb
		ELSE creator
	END ORDER BY position), '[]'::jsonb)
	FROM jsonb_array_elements(creators) WITH ORDINALITY AS entries(creator, position)
$$;
--> statement-breakpoint
UPDATE "item" SET "creators" = "creators_marking_organisations"("creators")
WHERE "sourceConnectionKey" = 'native' AND jsonb_typeof("creators") = 'array'
	AND "creators" IS DISTINCT FROM "creators_marking_organisations"("creators");
--> statement-breakpoint
UPDATE "itemDraft" SET "patch" = jsonb_set("patch", '{creators}', "creators_marking_organisations"("patch"->'creators'))
WHERE "sourceConnectionKey" = 'native' AND jsonb_typeof("patch"->'creators') = 'array'
	AND "patch"->'creators' IS DISTINCT FROM "creators_marking_organisations"("patch"->'creators');
--> statement-breakpoint
CREATE FUNCTION "review_records_marking_organisations"(records jsonb) RETURNS jsonb LANGUAGE sql STABLE AS $$
	SELECT COALESCE(jsonb_agg(CASE
		WHEN identity."sourceConnectionKey" = 'native' AND jsonb_typeof(record->'payload'->'creators') = 'array'
		THEN jsonb_set(record, '{payload,creators}', "creators_marking_organisations"(record->'payload'->'creators'))
		ELSE record
	END ORDER BY position), '[]'::jsonb)
	FROM jsonb_array_elements(records) WITH ORDINALITY AS entries(record, position)
	LEFT JOIN "itemIdentity" identity ON identity."key" = record->>'itemKey'
$$;
--> statement-breakpoint
UPDATE "itemReview" SET
	"snapshot" = jsonb_set("snapshot", '{records}', "review_records_marking_organisations"("snapshot"->'records')),
	"corrections" = "review_records_marking_organisations"("corrections")
WHERE "state" IN ('pending', 'returned')
	AND jsonb_typeof("snapshot"->'records') = 'array' AND jsonb_typeof("corrections") = 'array'
	AND ("snapshot"->'records' IS DISTINCT FROM "review_records_marking_organisations"("snapshot"->'records')
		OR "corrections" IS DISTINCT FROM "review_records_marking_organisations"("corrections"));
--> statement-breakpoint
DROP FUNCTION "review_records_marking_organisations"(jsonb);
--> statement-breakpoint
DROP FUNCTION "creators_marking_organisations"(jsonb);
