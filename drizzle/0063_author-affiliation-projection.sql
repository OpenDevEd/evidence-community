ALTER TABLE "itemInstitution" ADD COLUMN "source" text DEFAULT 'record' NOT NULL;--> statement-breakpoint
ALTER TABLE "itemInstitution" DROP CONSTRAINT "itemInstitution_itemKey_institutionName_pk";--> statement-breakpoint
ALTER TABLE "itemInstitution" ADD CONSTRAINT "itemInstitution_itemKey_institutionName_source_pk" PRIMARY KEY("itemKey","institutionName","source");--> statement-breakpoint

-- The projection also lists the authors' affiliations, marked by source, so
-- the institution filter, the pickers and the statistics read one indexed
-- table. The record's own institution field is unchanged.
CREATE OR REPLACE FUNCTION refresh_record_institution_projection(requested_key text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	root_key varchar(8);
BEGIN
	IF requested_key IS NULL OR requested_key = '' THEN
		RETURN;
	END IF;

	SELECT COALESCE(NULLIF(i."parentItem", ''), requested_key)
	INTO root_key
	FROM (SELECT requested_key::varchar(8) AS key) requested
	LEFT JOIN "item" i ON i.key = requested.key;

	root_key := COALESCE(root_key, requested_key::varchar(8));

	DELETE FROM "itemInstitution"
	WHERE "itemKey" IN (requested_key::varchar(8), root_key);

	INSERT INTO "itemInstitution" ("itemKey", "institutionName", "source")
	SELECT DISTINCT
		i.key,
		btrim(institution_name),
		'record'
	FROM "item" i
	CROSS JOIN LATERAL regexp_split_to_table(COALESCE(i.publisher, ''), E'\\|') AS institution_name
	WHERE i.key = root_key
		AND i.deleted = 0
		AND (i."parentItem" IS NULL OR i."parentItem" = '')
		-- Keep this set aligned with the Zotero schema mapping used by
		-- recordInstitution in src/lib/publication/record-adapter.ts.
		AND i."itemType" IN ('Manuscript', 'Report', 'Thesis')
		AND btrim(institution_name) <> ''
	ON CONFLICT DO NOTHING;

	INSERT INTO "itemInstitution" ("itemKey", "institutionName", "source")
	SELECT DISTINCT
		i.key,
		btrim(affiliation ->> 'display_name'),
		'author'
	FROM "item" i
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(i.creators) = 'array' THEN i.creators ELSE '[]'::jsonb END
	) AS creator
	CROSS JOIN LATERAL jsonb_array_elements(
		CASE WHEN jsonb_typeof(creator -> 'institutions') = 'array'
			THEN creator -> 'institutions' ELSE '[]'::jsonb END
	) AS affiliation
	WHERE i.key = root_key
		AND i.deleted = 0
		AND (i."parentItem" IS NULL OR i."parentItem" = '')
		AND btrim(COALESCE(affiliation ->> 'display_name', '')) <> ''
	ON CONFLICT DO NOTHING;
END;
$$;--> statement-breakpoint

INSERT INTO "itemInstitution" ("itemKey", "institutionName", "source")
SELECT DISTINCT
	i.key,
	btrim(affiliation ->> 'display_name'),
	'author'
FROM "item" i
CROSS JOIN LATERAL jsonb_array_elements(
	CASE WHEN jsonb_typeof(i.creators) = 'array' THEN i.creators ELSE '[]'::jsonb END
) AS creator
CROSS JOIN LATERAL jsonb_array_elements(
	CASE WHEN jsonb_typeof(creator -> 'institutions') = 'array'
		THEN creator -> 'institutions' ELSE '[]'::jsonb END
) AS affiliation
WHERE i.deleted = 0
	AND (i."parentItem" IS NULL OR i."parentItem" = '')
	AND btrim(COALESCE(affiliation ->> 'display_name', '')) <> ''
ON CONFLICT DO NOTHING;--> statement-breakpoint

-- The institution filter reads a new search field. Only a rebuild adds it to
-- documents that are already indexed.
UPDATE "status" SET "searchIndexRebuildPending" = true, "updatedAt" = now();
