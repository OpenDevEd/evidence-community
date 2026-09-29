-- Rollback: keep these columns. They are nullable, and older runtimes neither
-- read nor write them, so rolling the application back needs no schema change.
-- A full reversal drops sourceSyncRun.stage and sourceSyncRun.pdfsMissed; they
-- only describe runs in progress, and no library data lives in them.
ALTER TABLE "sourceSyncRun" ADD COLUMN "stage" text;--> statement-breakpoint
ALTER TABLE "sourceSyncRun" ADD COLUMN "pdfsMissed" integer;