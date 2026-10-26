-- Values that take long to compute, such as library statistics, which Meilisearch's `cache` index held until search
-- moves to Elasticsearch (OpenDevEd/new-el#716).
-- Rollback: drizzle/rollback/0096_computed-cache.sql.
CREATE TABLE "computedCache" (
	"key" varchar PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"computedAt" timestamp with time zone NOT NULL
);
