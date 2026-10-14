-- The library's PDF import, read in the publication worker so it survives the editor's tab closing. One import
-- is open at a time; its PDFs wait in private storage until they are imported as drafts or the import is discarded.
CREATE TABLE "pdfImport" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"createdBy" text NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"checks" jsonb NOT NULL,
	"instructions" text NOT NULL,
	"collections" jsonb NOT NULL,
	"commitStartedAt" timestamp with time zone,
	"results" jsonb,
	"closedAt" timestamp with time zone,
	"filesRemovedAt" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pdfImport_one_open" ON "pdfImport" USING btree ((true)) WHERE "closedAt" IS NULL;
--> statement-breakpoint
CREATE TABLE "pdfImportFile" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"importId" uuid NOT NULL REFERENCES "pdfImport"("id") ON DELETE CASCADE,
	"position" integer NOT NULL,
	"filename" text NOT NULL,
	"objectPath" text,
	"reading" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone,
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"lastError" text,
	"sha256" text,
	"attachTo" text,
	"attachState" text,
	"attachmentKey" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pdfImportFile_position" ON "pdfImportFile" USING btree ("importId", "position");
--> statement-breakpoint
CREATE INDEX "pdfImportFile_pending_idx" ON "pdfImportFile" USING btree ("nextAttemptAt") WHERE "nextAttemptAt" IS NOT NULL;
