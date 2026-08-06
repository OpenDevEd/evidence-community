CREATE TABLE "sourceRecordIssue" (
	"sourceConnectionKey" varchar(64) NOT NULL,
	"sourceRecordKey" varchar(512) NOT NULL,
	"code" varchar(64) NOT NULL,
	"message" varchar(4096) NOT NULL,
	"remoteVersion" varchar(255),
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sourceRecordIssue_sourceConnectionKey_sourceRecordKey_pk" PRIMARY KEY("sourceConnectionKey","sourceRecordKey")
);
--> statement-breakpoint
DROP INDEX "sourceFileCleanup_connection_created_idx";--> statement-breakpoint
ALTER TABLE "sourceFileCleanup" ADD COLUMN "deadLetteredAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sourceRecordIssue" ADD CONSTRAINT "sourceRecordIssue_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "sourceRecordIssue_connection_updated_idx" ON "sourceRecordIssue" USING btree ("sourceConnectionKey","updatedAt");--> statement-breakpoint
CREATE INDEX "sourceFileCleanup_connection_created_idx" ON "sourceFileCleanup" USING btree ("sourceConnectionKey","createdAt") WHERE "sourceFileCleanup"."deadLetteredAt" IS NULL;