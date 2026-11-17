-- A record's own licence, which its DOI goes out under (OpenDevEd/new-el#889), in place of one licence for the whole
-- library. Null, the value every existing record gets, means none was chosen: a record with a DOI already keeps the
-- library's Zenodo licence its deposits went out with, and a new DOI waits for one.
-- Rollback: drizzle/rollback/0110_item-licence.sql.
ALTER TABLE "item" ADD COLUMN "licence" jsonb;
