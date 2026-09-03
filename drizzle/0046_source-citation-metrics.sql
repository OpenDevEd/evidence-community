DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "item" i
		LEFT JOIN "sourceConnection" source
			ON source."key" = i."sourceConnectionKey"
		LEFT JOIN "itemSourceLink" source_link
			ON source_link."itemKey" = i."key"
			AND source_link."sourceConnectionKey" = i."sourceConnectionKey"
		WHERE (i."relations" ? 'cited_by' OR i."relations" ? 'referenced_works')
			AND (
				source."provider" IS DISTINCT FROM 'openalex'
				OR source_link."itemKey" IS NULL
				OR (
					i."relations" ? 'cited_by'
					AND (
						jsonb_typeof(i."relations"->'cited_by') IS DISTINCT FROM 'number'
						OR i."relations"->>'cited_by' !~ '^[0-9]+$'
					)
				)
				OR (
					i."relations" ? 'referenced_works'
					AND jsonb_typeof(i."relations"->'referenced_works') IS DISTINCT FROM 'array'
				)
			)
	) THEN
		RAISE EXCEPTION 'Cannot migrate one or more legacy OpenAlex citation fields';
	END IF;
END $$;--> statement-breakpoint
CREATE TABLE "itemCitationMetric" (
	"itemKey" varchar(8) NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"citedByCount" integer,
	"referencedWorksCount" integer,
	"observedAt" timestamp with time zone NOT NULL,
	CONSTRAINT "itemCitationMetric_itemKey_sourceConnectionKey_pk" PRIMARY KEY("itemKey","sourceConnectionKey"),
	CONSTRAINT "itemCitationMetric_has_count" CHECK ("itemCitationMetric"."citedByCount" IS NOT NULL OR "itemCitationMetric"."referencedWorksCount" IS NOT NULL),
	CONSTRAINT "itemCitationMetric_cited_by_nonnegative" CHECK ("itemCitationMetric"."citedByCount" IS NULL OR "itemCitationMetric"."citedByCount" >= 0),
	CONSTRAINT "itemCitationMetric_references_nonnegative" CHECK ("itemCitationMetric"."referencedWorksCount" IS NULL OR "itemCitationMetric"."referencedWorksCount" >= 0)
);
--> statement-breakpoint
ALTER TABLE "itemCitationMetric" ADD CONSTRAINT "itemCitationMetric_item_source_link_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."itemSourceLink"("itemKey","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itemCitationMetric_source_idx" ON "itemCitationMetric" USING btree ("sourceConnectionKey","itemKey");--> statement-breakpoint
INSERT INTO "itemCitationMetric" (
	"itemKey",
	"sourceConnectionKey",
	"citedByCount",
	"referencedWorksCount",
	"observedAt"
)
SELECT
	i."key",
	i."sourceConnectionKey",
	CASE
		WHEN jsonb_typeof(i."relations"->'cited_by') = 'number'
			AND i."relations"->>'cited_by' ~ '^[0-9]+$'
		THEN (i."relations"->>'cited_by')::integer
		ELSE NULL
	END,
	CASE
		WHEN jsonb_typeof(i."relations"->'referenced_works') = 'array'
		THEN jsonb_array_length(i."relations"->'referenced_works')
		ELSE NULL
	END,
	i."updatedAt"
FROM "item" i
JOIN "sourceConnection" source
	ON source."key" = i."sourceConnectionKey"
	AND source."provider" = 'openalex'
JOIN "itemSourceLink" source_link
	ON source_link."itemKey" = i."key"
	AND source_link."sourceConnectionKey" = i."sourceConnectionKey"
WHERE
	(jsonb_typeof(i."relations"->'cited_by') = 'number'
		AND i."relations"->>'cited_by' ~ '^[0-9]+$')
	OR jsonb_typeof(i."relations"->'referenced_works') = 'array'
ON CONFLICT ("itemKey", "sourceConnectionKey") DO UPDATE SET
	"citedByCount" = excluded."citedByCount",
	"referencedWorksCount" = excluded."referencedWorksCount",
	"observedAt" = excluded."observedAt";--> statement-breakpoint
INSERT INTO "itemLink" ("fromKey", "toKey", "kind", "origin")
SELECT DISTINCT
	i."key",
	target."itemKey",
	'cites',
	'source:' || i."sourceConnectionKey"
FROM "item" i
JOIN "sourceConnection" source
	ON source."key" = i."sourceConnectionKey"
	AND source."provider" = 'openalex'
CROSS JOIN LATERAL jsonb_array_elements_text(
	CASE
		WHEN jsonb_typeof(i."relations"->'referenced_works') = 'array'
		THEN i."relations"->'referenced_works'
		ELSE '[]'::jsonb
	END
) referenced("sourceRecordKey")
JOIN "itemSourceLink" target
	ON target."sourceConnectionKey" = i."sourceConnectionKey"
	AND regexp_replace(
		target."sourceRecordKey",
		'^https?://openalex[.]org/',
		''
	) = regexp_replace(
		referenced."sourceRecordKey",
		'^https?://openalex[.]org/',
		''
	)
WHERE i."key" <> target."itemKey"
ON CONFLICT DO NOTHING;--> statement-breakpoint
UPDATE "item"
SET "relations" = "relations" - 'cited_by' - 'referenced_works'
WHERE "relations" ? 'cited_by' OR "relations" ? 'referenced_works';
