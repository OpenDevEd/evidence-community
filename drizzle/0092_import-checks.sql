-- The AI checks a PDF import read a record's PDF against, kept with the exact upload they were read from: the
-- attachment and the private object its PDF was uploaded as, which publishing keeps as the published copy's source.
CREATE TABLE "itemImportCheck" (
	"attachmentKey" varchar(8) PRIMARY KEY NOT NULL REFERENCES "itemIdentity"("key") ON DELETE CASCADE,
	"parentKey" varchar(8) NOT NULL,
	"objectPath" text NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"filename" text NOT NULL,
	"checks" jsonb NOT NULL,
	"suggestions" jsonb NOT NULL,
	"readAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "itemImportCheck_parent_idx" ON "itemImportCheck" USING btree ("parentKey");
