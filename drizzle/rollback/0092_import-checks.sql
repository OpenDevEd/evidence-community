-- Rollback for 0092_import-checks. The runtime before it doesn't keep or show the checks a PDF import read a record's
-- PDF against. Dropping the table loses them; the records, their PDFs and the imports are untouched.
DROP TABLE IF EXISTS "itemImportCheck";
