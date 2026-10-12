-- An editor's correction of a record's study type, made in /admin (OpenDevEd/new-el#591). Null, the value every
-- existing record gets, leaves the type to the record's reading.
-- Rollback: drizzle/rollback/0088_item-study-type.sql.
ALTER TABLE "item" ADD COLUMN "studyType" varchar;
