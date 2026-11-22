-- Rollback for 0114_creator-organisation. The previous runtime refuses a creator field it doesn't know, and would send
-- one to Zotero, so the "organization" mark comes off every author: records, drafts and reviews of every source. Its
-- creator card reads a one-field name as an organisation again, so the authors the migration marked still show as
-- organisations there; an author an editor switched from Person to Organisation on a one-field name shows as one too.
CREATE FUNCTION "creators_without_organisation"(creators jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT COALESCE(jsonb_agg(CASE WHEN jsonb_typeof(creator) = 'object' THEN creator - 'organization' ELSE creator END ORDER BY position), '[]'::jsonb)
	FROM jsonb_array_elements(creators) WITH ORDINALITY AS entries(creator, position)
$$;
UPDATE "item" SET "creators" = "creators_without_organisation"("creators")
WHERE jsonb_typeof("creators") = 'array' AND "creators"::text LIKE '%"organization"%';
UPDATE "itemDraft" SET "patch" = jsonb_set("patch", '{creators}', "creators_without_organisation"("patch"->'creators'))
WHERE jsonb_typeof("patch"->'creators') = 'array' AND "patch"->>'creators' LIKE '%"organization"%';
CREATE FUNCTION "review_records_without_organisation"(records jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
	SELECT COALESCE(jsonb_agg(CASE
		WHEN jsonb_typeof(record->'payload'->'creators') = 'array'
		THEN jsonb_set(record, '{payload,creators}', "creators_without_organisation"(record->'payload'->'creators'))
		ELSE record
	END ORDER BY position), '[]'::jsonb)
	FROM jsonb_array_elements(records) WITH ORDINALITY AS entries(record, position)
$$;
UPDATE "itemReview" SET
	"snapshot" = jsonb_set("snapshot", '{records}', "review_records_without_organisation"("snapshot"->'records')),
	"corrections" = "review_records_without_organisation"("corrections")
WHERE jsonb_typeof("snapshot"->'records') = 'array' AND jsonb_typeof("corrections") = 'array'
	AND ("snapshot"::text LIKE '%"organization"%' OR "corrections"::text LIKE '%"organization"%');
DROP FUNCTION "review_records_without_organisation"(jsonb);
DROP FUNCTION "creators_without_organisation"(jsonb);
