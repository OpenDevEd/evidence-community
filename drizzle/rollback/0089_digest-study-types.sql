-- Rollback for 0089_digest-study-types. The per-type counts are lost. The likely-review table comes back empty, and
-- stored publications keep their study types, which the earlier code ignores: until OpenScholar reads them again, a
-- digest page lists every publication in one list.
ALTER TABLE "notificationEdition" DROP COLUMN "studyTypes";
CREATE TABLE "notificationItemKind" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"readAt" timestamp with time zone DEFAULT now() NOT NULL
);
