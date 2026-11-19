-- A removed record's attachments keep their file rows, so restoring it puts the same PDF back (withdrawn-files.ts), but
-- the PDF has left public view. The records table counts a PDF as live only while its attachment is.
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
				WHEN EXISTS (
					SELECT 1 FROM "itemFilePublication" file
					JOIN "item" attachment ON attachment.key = file."itemKey"
					WHERE file."parentItemKey" = effective.key AND attachment.deleted = 0
				) THEN 'published'
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
				WHEN EXISTS (
					SELECT 1 FROM "itemSourceFileChoice" choice
					JOIN "item" attachment ON attachment.key = choice."itemKey"
					WHERE attachment."parentItem" = effective.key AND choice.pending = 'publish'
				) THEN 'staged'
				WHEN EXISTS (
					SELECT 1 FROM "itemSourceFileChoice" choice
					JOIN "item" attachment ON attachment.key = choice."itemKey"
					WHERE attachment."parentItem" = effective.key AND NOT choice.applied
				) THEN 'processing'
				WHEN EXISTS (
					SELECT 1 FROM "item" attachment
					WHERE attachment."parentItem" = effective.key
						AND attachment."itemType" = 'Attachment'
						AND attachment.deleted = 0
						AND lower(attachment."contentType") = 'application/pdf'
						AND attachment."linkMode" IN ('imported_file', 'imported_url')
				) THEN 'unpublished'
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
		left(lower(projected.title), 512),
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
$$;--> statement-breakpoint
SELECT refresh_admin_item_list_projection(projection.key)
FROM "adminItemListProjection" projection
WHERE projection."fileState" = 'published'
	AND EXISTS (
		SELECT 1 FROM "itemFilePublication" file
		JOIN "item" attachment ON attachment.key = file."itemKey"
		WHERE file."parentItemKey" = projection.key AND attachment.deleted = 1
	);
