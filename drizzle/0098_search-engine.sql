-- The engine whose index holds every one of the library's records, which its readers search (OpenDevEd/new-el#722).
-- The search worker sets it once a first build or a switch to another engine is complete; empty before that.
-- Rollback: drizzle/rollback/0098_search-engine.sql.
ALTER TABLE "status" ADD COLUMN "searchEngine" text;--> statement-breakpoint
ALTER TABLE "status" ADD CONSTRAINT "status_search_engine" CHECK ("searchEngine" IN ('elasticsearch', 'meilisearch'));
