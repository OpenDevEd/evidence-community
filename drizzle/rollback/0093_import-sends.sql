-- Rollback for 0093_import-sends. The runtime before it never sends imported drafts on by itself; an import that was
-- sending them leaves the rest as drafts, which the finish step can still publish.
ALTER TABLE "pdfImportFile" DROP COLUMN IF EXISTS "sendError";
ALTER TABLE "pdfImportFile" DROP COLUMN IF EXISTS "sendState";
ALTER TABLE "pdfImport" DROP COLUMN IF EXISTS "send";
