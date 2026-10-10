CREATE TABLE "notificationEditionEvent" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"editionId" uuid NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"kind" text NOT NULL,
	"actor" jsonb
);
--> statement-breakpoint
ALTER TABLE "notificationEdition" ADD COLUMN "draftRevision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notificationEdition" ADD COLUMN "reviewRequestedAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "notificationEdition" ADD COLUMN "note" text;--> statement-breakpoint
ALTER TABLE "notificationEdition" ADD COLUMN "checkedBy" jsonb;--> statement-breakpoint
ALTER TABLE "notificationEditionEvent" ADD CONSTRAINT "notificationEditionEvent_editionId_notificationEdition_id_fk" FOREIGN KEY ("editionId") REFERENCES "public"."notificationEdition"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notificationEditionEvent_edition_idx" ON "notificationEditionEvent" USING btree ("editionId","at");--> statement-breakpoint
-- Every digest so far was written by AI when it was published, whether or not its text was kept apart as AI's.
INSERT INTO "notificationEditionEvent" ("editionId", "at", "kind")
  SELECT "id", "publishedAt", 'written' FROM "notificationEdition" WHERE "stream" = 'digest' AND "markdown" IS NOT NULL AND "publishedAt" IS NOT NULL;
