ALTER TABLE "notificationState" RENAME COLUMN "weeklyThrough" TO "digestThrough";
--> statement-breakpoint
ALTER TABLE "notificationState" RENAME COLUMN "nextWeeklyAt" TO "nextDigestAt";
--> statement-breakpoint
ALTER TABLE "notificationSubscriber" RENAME COLUMN "weekly" TO "digest";
--> statement-breakpoint
UPDATE "notificationEdition" SET "stream" = 'digest' WHERE "stream" = 'weekly';
--> statement-breakpoint
UPDATE "notificationState" SET "schedule" = (jsonb_build_object('frequency', 'weekly') || "schedule"::jsonb)::text;
