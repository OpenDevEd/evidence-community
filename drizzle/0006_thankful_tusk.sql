ALTER TABLE "collection" ADD COLUMN "sortOrder" integer;--> statement-breakpoint
WITH "ranked_native_collections" AS (
	SELECT
		"key",
		row_number() OVER (
			PARTITION BY "parentCollection"
			ORDER BY lower(coalesce("name", '')), "key"
		)::integer * 1024 AS "sortOrder"
	FROM "collection"
	WHERE "sourceConnectionKey" = 'native'
)
UPDATE "collection"
SET "sortOrder" = "ranked_native_collections"."sortOrder"
FROM "ranked_native_collections"
WHERE "collection"."key" = "ranked_native_collections"."key";--> statement-breakpoint
CREATE INDEX "collection_tree_order_idx" ON "collection" USING btree ("sourceConnectionKey","parentCollection","sortOrder","key");--> statement-breakpoint
ALTER TABLE "collection" ADD CONSTRAINT "collection_native_sort_order_required" CHECK ("collection"."sourceConnectionKey" <> 'native' OR "collection"."sortOrder" IS NOT NULL);
