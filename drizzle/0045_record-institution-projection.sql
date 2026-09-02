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

	INSERT INTO "itemInstitution" ("itemKey", "institutionName")
	SELECT DISTINCT
		i.key,
		btrim(institution_name)
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
END;
$$;--> statement-breakpoint

ALTER FUNCTION refresh_admin_item_list_projection(text)
RENAME TO refresh_admin_item_list_projection_core;--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_admin_item_list_projection_core(requested_key text)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	root_key varchar(8);
BEGIN
	IF requested_key IS NULL OR requested_key = '' THEN
		RETURN;
	END IF;

	SELECT COALESCE(
		CASE
			WHEN d.patch ? 'parentItem' THEN NULLIF(d.patch ->> 'parentItem', '')
			ELSE i."parentItem"
		END,
		requested_key
	)
	INTO root_key
	FROM (SELECT requested_key::varchar(8) AS key) requested
	LEFT JOIN "item" i ON i.key = requested.key
	LEFT JOIN "itemDraft" d ON d."itemKey" = requested.key;

	root_key := COALESCE(root_key, requested_key::varchar(8));
	PERFORM pg_advisory_xact_lock(
		hashtextextended('adminItemListProjection:' || root_key, 0)
	);
	IF root_key IS DISTINCT FROM requested_key::varchar(8) THEN
		DELETE FROM "adminItemListProjection"
		WHERE key = requested_key::varchar(8);
	END IF;

	WITH record AS (
		SELECT
			root_key AS key,
			i.key AS published_key,
			i."itemType" AS published_item_type,
			i.title AS published_title,
			i.creators AS published_creators,
			i.date AS published_date,
			i."sourceConnectionKey" AS published_source,
			i.revision AS published_revision,
			i.deleted AS published_deleted,
			i."parentItem" AS published_parent,
			i."dateAdded" AS published_date_added,
			i."updatedAt" AS published_updated_at,
			d."itemKey" AS draft_key,
			d.patch AS draft_patch,
			d."sourceConnectionKey" AS draft_source,
			d."createdAt" AS draft_created_at,
			d."updatedAt" AS draft_updated_at
		FROM (SELECT root_key AS key) requested
		LEFT JOIN "item" i ON i.key = requested.key
		LEFT JOIN "itemDraft" d ON d."itemKey" = requested.key
	), effective AS (
		SELECT
			record.*,
			CASE
				WHEN record.draft_patch ? 'itemType' THEN COALESCE(NULLIF(record.draft_patch ->> 'itemType', ''), 'Document')
				ELSE COALESCE(record.published_item_type::text, 'Document')
			END AS item_type,
			CASE
				WHEN record.draft_patch ? 'title' THEN COALESCE(NULLIF(btrim(record.draft_patch ->> 'title'), ''), 'Untitled')
				ELSE COALESCE(NULLIF(btrim(record.published_title), ''), 'Untitled')
			END AS title,
			CASE
				WHEN record.draft_patch ? 'creators' THEN
					CASE WHEN jsonb_typeof(record.draft_patch -> 'creators') = 'array' THEN record.draft_patch -> 'creators' ELSE '[]'::jsonb END
				WHEN jsonb_typeof(record.published_creators) = 'array' THEN record.published_creators
				ELSE '[]'::jsonb
			END AS creators,
			CASE
				WHEN record.draft_patch ? 'date' THEN NULLIF(record.draft_patch ->> 'date', '')
				ELSE record.published_date
			END AS item_date
		FROM record
	), projected AS (
		SELECT
			effective.*,
			COALESCE((
				SELECT array_agg(DISTINCT creator_name ORDER BY creator_name)
				FROM (
					SELECT NULLIF(btrim(COALESCE(
						creator ->> 'name',
						concat_ws(' ', creator ->> 'firstName', creator ->> 'lastName')
					)), '') AS creator_name
					FROM jsonb_array_elements(effective.creators) creator
				) names
				WHERE creator_name IS NOT NULL
			), ARRAY[]::text[]) AS creator_names,
			CASE
				WHEN effective.item_date ~ '(1[0-9]{3}|2[0-9]{3})'
					THEN substring(effective.item_date from '(1[0-9]{3}|2[0-9]{3})')::integer
				ELSE NULL
			END AS item_year,
			CASE
				WHEN effective.draft_key IS NOT NULL AND effective.draft_patch ? 'collections' THEN COALESCE((
					SELECT array_agg(DISTINCT value ORDER BY value)
					FROM jsonb_array_elements_text(
						CASE WHEN jsonb_typeof(effective.draft_patch -> 'collections') = 'array'
							THEN effective.draft_patch -> 'collections' ELSE '[]'::jsonb END
					) value
				), ARRAY[]::text[])
				ELSE COALESCE((
					SELECT array_agg(membership."collectionKey" ORDER BY membership."collectionKey")
					FROM "itemToCollection" membership
					WHERE membership."itemKey" = effective.key
				), ARRAY[]::text[])
			END AS collection_keys,
			CASE
				WHEN effective.draft_key IS NOT NULL AND effective.draft_patch ? 'tags' THEN COALESCE((
					SELECT array_agg(DISTINCT value ORDER BY value)
					FROM jsonb_array_elements_text(
						CASE WHEN jsonb_typeof(effective.draft_patch -> 'tags') = 'array'
							THEN effective.draft_patch -> 'tags' ELSE '[]'::jsonb END
					) value
				), ARRAY[]::text[])
				ELSE COALESCE((
					SELECT array_agg(membership."tagName" ORDER BY membership."tagName")
					FROM "itemToTag" membership
					WHERE membership."itemKey" = effective.key
				), ARRAY[]::text[])
			END AS tag_names,
			CASE
				WHEN EXISTS (SELECT 1 FROM "itemFilePublication" file WHERE file."parentItemKey" = effective.key) THEN 'published'
				WHEN EXISTS (
					SELECT 1 FROM "item" attachment
					WHERE attachment."parentItem" = effective.key
						AND attachment."itemType" = 'Attachment'
						AND attachment.deleted = 0
						AND lower(attachment."contentType") = 'application/pdf'
						AND NULLIF(attachment.url, '') IS NOT NULL
				) THEN 'published'
				WHEN EXISTS (SELECT 1 FROM "itemFileDraft" file WHERE file."parentItemKey" = effective.key AND file."readyAt" IS NOT NULL) THEN 'staged'
				WHEN EXISTS (SELECT 1 FROM "itemFileDraft" file WHERE file."parentItemKey" = effective.key) THEN 'processing'
				ELSE 'none'
			END AS file_state,
			COALESCE(
				(SELECT max(file."pageCount") FROM "itemFilePublication" file WHERE file."parentItemKey" = effective.key),
				(SELECT max(file."pageCount") FROM "itemFileDraft" file WHERE file."parentItemKey" = effective.key)
			) AS page_count
		FROM effective
	)
	INSERT INTO "adminItemListProjection" (
		key, "itemType", title, "titleSort", creators, "creatorNames", date, year,
		"sourceConnectionKey", revision, state, "fileState", "updatedAt", "dateAdded",
		collections, tags, "pageCount", "searchText"
	)
	SELECT
		projected.key,
		projected.item_type,
		projected.title,
		lower(projected.title),
		projected.creators,
		projected.creator_names,
		projected.item_date,
		projected.item_year,
		COALESCE(projected.draft_source, projected.published_source),
		COALESCE(projected.published_revision, 0),
		CASE
			WHEN projected.published_deleted = 1 THEN 'deleted'
			WHEN projected.published_key IS NULL THEN 'draft'
			WHEN projected.draft_key IS NOT NULL THEN 'edited'
			ELSE 'published'
		END,
		projected.file_state,
		date_trunc('milliseconds', GREATEST(
			COALESCE(projected.draft_updated_at, '-infinity'::timestamptz),
			COALESCE(projected.published_updated_at, '-infinity'::timestamptz)
		)),
		COALESCE(
			projected.published_date_added AT TIME ZONE 'UTC',
			projected.draft_created_at
		),
		projected.collection_keys,
		projected.tag_names,
		projected.page_count,
		concat_ws(' ',
			projected.key,
			projected.title,
			projected.item_date,
			array_to_string(projected.creator_names, ' '),
			array_to_string(projected.tag_names, ' ')
		)
	FROM projected
	WHERE (projected.published_key IS NOT NULL OR projected.draft_key IS NOT NULL)
		AND (
			CASE
				WHEN projected.draft_patch ? 'parentItem' THEN NULLIF(projected.draft_patch ->> 'parentItem', '')
				ELSE projected.published_parent
			END
		) IS NULL
	ON CONFLICT (key) DO UPDATE SET
		"itemType" = EXCLUDED."itemType",
		title = EXCLUDED.title,
		"titleSort" = EXCLUDED."titleSort",
		creators = EXCLUDED.creators,
		"creatorNames" = EXCLUDED."creatorNames",
		date = EXCLUDED.date,
		year = EXCLUDED.year,
		"sourceConnectionKey" = EXCLUDED."sourceConnectionKey",
		revision = EXCLUDED.revision,
		state = EXCLUDED.state,
		"fileState" = EXCLUDED."fileState",
		"updatedAt" = EXCLUDED."updatedAt",
		"dateAdded" = EXCLUDED."dateAdded",
		collections = EXCLUDED.collections,
		tags = EXCLUDED.tags,
		"pageCount" = EXCLUDED."pageCount",
		"searchText" = EXCLUDED."searchText";

	IF NOT FOUND THEN
		DELETE FROM "adminItemListProjection" WHERE key = root_key;
	END IF;
END;
$$;

CREATE OR REPLACE FUNCTION refresh_admin_item_list_projection(requested_key text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
	PERFORM refresh_admin_item_list_projection_core(requested_key);
	PERFORM refresh_record_institution_projection(requested_key);
END;
$$;--> statement-breakpoint

CREATE OR REPLACE FUNCTION trigger_admin_item_list_projection_refresh()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_rows jsonb := '[]'::jsonb;
	new_rows jsonb := '[]'::jsonb;
	requested_key text;
	resolved_root text;
BEGIN
	IF TG_ARGV[0] <> '' THEN
		EXECUTE format(
			'SELECT COALESCE(jsonb_agg(to_jsonb(changed)), ''[]''::jsonb) FROM %I changed',
			TG_ARGV[0]
		) INTO old_rows;
	END IF;
	IF TG_ARGV[1] <> '' THEN
		EXECUTE format(
			'SELECT COALESCE(jsonb_agg(to_jsonb(changed)), ''[]''::jsonb) FROM %I changed',
			TG_ARGV[1]
		) INTO new_rows;
	END IF;

	FOR requested_key, resolved_root IN
		WITH changed_rows AS (
			SELECT value AS row
			FROM jsonb_array_elements(old_rows || new_rows)
		), candidates AS (
			SELECT COALESCE(row ->> 'key', row ->> 'itemKey') AS key
			FROM changed_rows
			UNION
			SELECT COALESCE(
				row ->> 'parentItemKey',
				row ->> 'parentItem',
				row -> 'patch' ->> 'parentItem'
			) AS key
			FROM changed_rows
		), roots AS (
			SELECT
				candidates.key AS requested,
				COALESCE(
					CASE
						WHEN d.patch ? 'parentItem' THEN NULLIF(d.patch ->> 'parentItem', '')
						ELSE i."parentItem"
					END,
					candidates.key
				) AS root
			FROM candidates
			LEFT JOIN "item" i ON i.key = candidates.key
			LEFT JOIN "itemDraft" d ON d."itemKey" = candidates.key
			WHERE candidates.key IS NOT NULL AND candidates.key <> ''
		)
		SELECT requested, root
		FROM roots
		ORDER BY root, requested
	LOOP
		PERFORM pg_advisory_xact_lock(
			hashtextextended('adminItemListProjection:' || resolved_root, 0)
		);
		PERFORM refresh_admin_item_list_projection(requested_key);
	END LOOP;
	RETURN NULL;
END;
$$;--> statement-breakpoint

DELETE FROM "itemInstitution";--> statement-breakpoint

INSERT INTO "itemInstitution" ("itemKey", "institutionName")
SELECT DISTINCT
	i.key,
	btrim(institution_name)
FROM "item" i
CROSS JOIN LATERAL regexp_split_to_table(COALESCE(i.publisher, ''), E'\\|') AS institution_name
WHERE i.deleted = 0
	AND (i."parentItem" IS NULL OR i."parentItem" = '')
	-- Keep this set aligned with the Zotero schema mapping used by
	-- recordInstitution in src/lib/publication/record-adapter.ts.
	AND i."itemType" IN ('Manuscript', 'Report', 'Thesis')
	AND btrim(institution_name) <> ''
ON CONFLICT DO NOTHING;
