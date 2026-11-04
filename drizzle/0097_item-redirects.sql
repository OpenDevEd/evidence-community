-- Old record keys that `/lib/{key}` redirects to the current key, which Meilisearch's `redirects` index held until
-- search moves to Elasticsearch (OpenDevEd/new-el#716). `npm run search:copy-redirects` copies a library's redirects.
-- Rollback: drizzle/rollback/0097_item-redirects.sql.
CREATE TABLE "itemRedirect" (
	"fromKey" varchar PRIMARY KEY NOT NULL,
	"toKey" varchar NOT NULL
);
