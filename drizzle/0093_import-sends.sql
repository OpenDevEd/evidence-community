-- Whether importing sends the drafts on once their PDFs are attached, and as whom: the editor who imported them and the
-- DOI route they chose. Null keeps them as drafts, as before.
ALTER TABLE "pdfImport" ADD COLUMN "send" jsonb;
--> statement-breakpoint
-- Where sending each draft on stands: waiting for its PDF and the worker, sent, held for something publishing needs, or
-- failed, with why.
ALTER TABLE "pdfImportFile" ADD COLUMN "sendState" text;
--> statement-breakpoint
ALTER TABLE "pdfImportFile" ADD COLUMN "sendError" text;
