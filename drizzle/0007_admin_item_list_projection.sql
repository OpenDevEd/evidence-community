CREATE TABLE "adminItemListProjection" (
	"key" varchar(8) PRIMARY KEY NOT NULL,
	"itemType" text NOT NULL,
	"title" text NOT NULL,
	"titleSort" text NOT NULL,
	"creators" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"creatorNames" text[] DEFAULT '{}' NOT NULL,
	"date" text,
	"year" integer,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"revision" bigint NOT NULL,
	"state" text NOT NULL,
	"fileState" text NOT NULL,
	"updatedAt" timestamp with time zone NOT NULL,
	"dateAdded" timestamp with time zone,
	"collections" text[] DEFAULT '{}' NOT NULL,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"pageCount" integer,
	"searchText" text NOT NULL,
	CONSTRAINT "adminItemListProjection_state_valid" CHECK ("state" IN ('deleted', 'draft', 'edited', 'published')),
	CONSTRAINT "adminItemListProjection_file_state_valid" CHECK ("fileState" IN ('none', 'processing', 'staged', 'published'))
);
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX "adminItemListProjection_updated_idx" ON "adminItemListProjection" USING btree ("updatedAt","key");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_title_idx" ON "adminItemListProjection" USING btree ("titleSort","key");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_year_idx" ON "adminItemListProjection" USING btree ("year","key");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_item_type_idx" ON "adminItemListProjection" USING btree ("itemType","key");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_page_count_idx" ON "adminItemListProjection" USING btree ("pageCount","key");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_source_idx" ON "adminItemListProjection" USING btree ("sourceConnectionKey");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_state_idx" ON "adminItemListProjection" USING btree ("state");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_file_state_idx" ON "adminItemListProjection" USING btree ("fileState");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_collections_idx" ON "adminItemListProjection" USING gin ("collections");--> statement-breakpoint
CREATE INDEX "adminItemListProjection_tags_idx" ON "adminItemListProjection" USING gin ("tags");
--> statement-breakpoint
CREATE INDEX "adminItemListProjection_search_idx" ON "adminItemListProjection" USING gin ("searchText" gin_trgm_ops);--> statement-breakpoint

CREATE OR REPLACE FUNCTION refresh_admin_item_list_projection(requested_key text)
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
		NULLIF(d.payload ->> 'parentItem', ''),
		i."parentItem",
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
			d.payload AS draft_payload,
			d."sourceConnectionKey" AS draft_source,
			d."createdAt" AS draft_created_at,
			d."updatedAt" AS draft_updated_at
		FROM (SELECT root_key AS key) requested
		LEFT JOIN "item" i ON i.key = requested.key
		LEFT JOIN "itemDraft" d ON d."itemKey" = requested.key
	), effective AS (
		SELECT
			record.*,
			COALESCE(NULLIF(record.draft_payload ->> 'itemType', ''), record.published_item_type::text, 'Document') AS item_type,
			COALESCE(NULLIF(btrim(record.draft_payload ->> 'title'), ''), NULLIF(btrim(record.published_title), ''), 'Untitled') AS title,
			CASE
				WHEN jsonb_typeof(record.draft_payload -> 'creators') = 'array' THEN record.draft_payload -> 'creators'
				WHEN jsonb_typeof(record.published_creators) = 'array' THEN record.published_creators
				ELSE '[]'::jsonb
			END AS creators,
			COALESCE(NULLIF(record.draft_payload ->> 'date', ''), record.published_date) AS item_date
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
				WHEN effective.draft_key IS NOT NULL AND effective.draft_payload ? 'collections' THEN COALESCE((
					SELECT array_agg(DISTINCT value ORDER BY value)
					FROM jsonb_array_elements_text(
						CASE WHEN jsonb_typeof(effective.draft_payload -> 'collections') = 'array'
							THEN effective.draft_payload -> 'collections' ELSE '[]'::jsonb END
					) value
				), ARRAY[]::text[])
				ELSE COALESCE((
					SELECT array_agg(membership."collectionKey" ORDER BY membership."collectionKey")
					FROM "itemToCollection" membership
					WHERE membership."itemKey" = effective.key
				), ARRAY[]::text[])
			END AS collection_keys,
			CASE
				WHEN effective.draft_key IS NOT NULL AND effective.draft_payload ? 'tags' THEN COALESCE((
					SELECT array_agg(DISTINCT value ORDER BY value)
					FROM jsonb_array_elements_text(
						CASE WHEN jsonb_typeof(effective.draft_payload -> 'tags') = 'array'
							THEN effective.draft_payload -> 'tags' ELSE '[]'::jsonb END
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
		AND COALESCE(NULLIF(projected.draft_payload ->> 'parentItem', ''), projected.published_parent) IS NULL
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
				row -> 'payload' ->> 'parentItem'
			) AS key
			FROM changed_rows
		), roots AS (
			SELECT
				candidates.key AS requested,
				COALESCE(
					NULLIF(d.payload ->> 'parentItem', ''),
					i."parentItem",
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

DROP TRIGGER IF EXISTS admin_item_list_item_refresh ON "item";--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_item_list_draft_refresh ON "itemDraft";--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_item_list_file_draft_refresh ON "itemFileDraft";--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_item_list_file_publication_refresh ON "itemFilePublication";--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_item_list_collection_membership_refresh ON "itemToCollection";--> statement-breakpoint
DROP TRIGGER IF EXISTS admin_item_list_tag_membership_refresh ON "itemToTag";--> statement-breakpoint

DO $$
DECLARE
	target record;
BEGIN
	FOR target IN
		SELECT * FROM (VALUES
			('item', 'item'),
			('itemDraft', 'draft'),
			('itemFileDraft', 'file_draft'),
			('itemFilePublication', 'file_publication'),
			('itemToCollection', 'collection_membership'),
			('itemToTag', 'tag_membership')
		) AS targets(table_name, trigger_name)
	LOOP
		EXECUTE format(
			'CREATE TRIGGER admin_item_list_%s_insert_refresh AFTER INSERT ON %I REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_admin_item_list_projection_refresh('''', ''new_rows'')',
			target.trigger_name,
			target.table_name
		);
		EXECUTE format(
			'CREATE TRIGGER admin_item_list_%s_update_refresh AFTER UPDATE ON %I REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_admin_item_list_projection_refresh(''old_rows'', ''new_rows'')',
			target.trigger_name,
			target.table_name
		);
		EXECUTE format(
			'CREATE TRIGGER admin_item_list_%s_delete_refresh AFTER DELETE ON %I REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trigger_admin_item_list_projection_refresh(''old_rows'', '''')',
			target.trigger_name,
			target.table_name
		);
	END LOOP;
END;
$$;--> statement-breakpoint

SELECT refresh_admin_item_list_projection(key)
FROM "itemIdentity";
