ALTER TABLE "notificationEdition" ADD COLUMN "publicationCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "notificationEdition" ADD COLUMN "cover" text;--> statement-breakpoint
ALTER TABLE "notificationItem" ADD COLUMN "hourlyEditionId" uuid;--> statement-breakpoint
ALTER TABLE "notificationItem" ADD COLUMN "digestEditionId" uuid;--> statement-breakpoint
ALTER TABLE "notificationItem" ADD CONSTRAINT "notificationItem_hourlyEditionId_notificationEdition_id_fk" FOREIGN KEY ("hourlyEditionId") REFERENCES "public"."notificationEdition"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificationItem" ADD CONSTRAINT "notificationItem_digestEditionId_notificationEdition_id_fk" FOREIGN KEY ("digestEditionId") REFERENCES "public"."notificationEdition"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notificationItem_hourly_pending_idx" ON "notificationItem" USING btree ("firstPublishedAt") WHERE "notificationItem"."eligible" = true AND "notificationItem"."hourlyEditionId" IS NULL;--> statement-breakpoint
CREATE INDEX "notificationItem_digest_pending_idx" ON "notificationItem" USING btree ("firstPublishedAt") WHERE "notificationItem"."eligible" = true AND "notificationItem"."digestEditionId" IS NULL;--> statement-breakpoint
UPDATE "notificationEdition" SET
	"publicationCount" = jsonb_array_length("publications"),
	"cover" = (
		SELECT entry->'item'->>'PDFCoverPageImage'
		FROM jsonb_array_elements("publications") WITH ORDINALITY AS listed(entry, position)
		WHERE entry->'item'->>'PDFCoverPageImage' IS NOT NULL
		ORDER BY position
		LIMIT 1
	);
--> statement-breakpoint
UPDATE "notificationItem" SET "hourlyEditionId" = edition."id"
FROM "notificationEdition" edition, jsonb_array_elements(edition."publications") AS entry
WHERE edition."stream" = 'hourly' AND entry->>'key' = "notificationItem"."itemKey";
--> statement-breakpoint
UPDATE "notificationItem" SET "digestEditionId" = edition."id"
FROM "notificationEdition" edition, jsonb_array_elements(edition."publications") AS entry
WHERE edition."stream" = 'digest' AND entry->>'key' = "notificationItem"."itemKey";
