ALTER TABLE "notificationState" ADD COLUMN "digestPaused" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "notificationState" ADD COLUMN "digestFloor" timestamp with time zone;