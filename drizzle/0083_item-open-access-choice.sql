-- An editor's choice of whether a record is open access, made in /admin (OpenDevEd/new-el#580). Null, the value every
-- existing record gets, leaves it to OpenAlex as before.
-- Rollback: drizzle/rollback/0083_item-open-access-choice.sql.
ALTER TABLE "item" ADD COLUMN "openAccess" boolean;
