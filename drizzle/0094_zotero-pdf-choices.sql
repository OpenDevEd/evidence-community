-- A Zotero source's PDFs can be published or taken down one at a time, through review. The library keeps the choice;
-- Zotero never sees it. `pending` is the change in the working draft, held by `reviewId` while a review is pending.
-- `choice` is the approved one, and `applied` turns true once the source's import has applied it.
CREATE TABLE "itemSourceFileChoice" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL REFERENCES "item"("key") ON DELETE CASCADE,
	"sourceConnectionKey" varchar(64) NOT NULL REFERENCES "sourceConnection"("key") ON UPDATE CASCADE ON DELETE CASCADE,
	"sourceRecordKey" varchar(512) NOT NULL,
	"choice" text,
	"pending" text,
	"reviewId" uuid REFERENCES "itemReview"("id") ON DELETE SET NULL,
	"applied" boolean DEFAULT true NOT NULL,
	"sizeBytes" bigint,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemSourceFileChoice_choice_valid" CHECK ("choice" IS NULL OR "choice" IN ('publish', 'withhold')),
	CONSTRAINT "itemSourceFileChoice_pending_valid" CHECK ("pending" IS NULL OR "pending" IN ('publish', 'withhold')),
	CONSTRAINT "itemSourceFileChoice_present" CHECK ("choice" IS NOT NULL OR "pending" IS NOT NULL)
);
--> statement-breakpoint
CREATE INDEX "itemSourceFileChoice_unapplied_idx" ON "itemSourceFileChoice" ("sourceConnectionKey") WHERE NOT "applied";
--> statement-breakpoint
CREATE INDEX "itemSourceFileChoice_review_idx" ON "itemSourceFileChoice" ("reviewId") WHERE "reviewId" IS NOT NULL;
--> statement-breakpoint
-- A record whose source PDF the library doesn't publish says so, instead of looking like one without a PDF.
ALTER TABLE "adminItemListProjection" DROP CONSTRAINT "adminItemListProjection_file_state_valid";
--> statement-breakpoint
ALTER TABLE "adminItemListProjection" ADD CONSTRAINT "adminItemListProjection_file_state_valid" CHECK ("fileState" IN ('none', 'processing', 'staged', 'published', 'unpublished'));
--> statement-breakpoint
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
-- A staged or approved choice changes what the records table says about the record's PDF.
CREATE TRIGGER admin_item_list_source_file_choice_insert_refresh AFTER INSERT ON "itemSourceFileChoice" REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_admin_item_list_projection_refresh('', 'new_rows');
--> statement-breakpoint
CREATE TRIGGER admin_item_list_source_file_choice_update_refresh AFTER UPDATE ON "itemSourceFileChoice" REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_admin_item_list_projection_refresh('old_rows', 'new_rows');
--> statement-breakpoint
CREATE TRIGGER admin_item_list_source_file_choice_delete_refresh AFTER DELETE ON "itemSourceFileChoice" REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_admin_item_list_projection_refresh('old_rows', '');
--> statement-breakpoint
UPDATE "adminItemListProjection" projection
SET "fileState" = 'unpublished'
WHERE projection."fileState" = 'none'
	AND EXISTS (
		SELECT 1 FROM "item" attachment
		WHERE attachment."parentItem" = projection.key
			AND attachment."itemType" = 'Attachment'
			AND attachment.deleted = 0
			AND lower(attachment."contentType") = 'application/pdf'
			AND attachment."linkMode" IN ('imported_file', 'imported_url')
	);
