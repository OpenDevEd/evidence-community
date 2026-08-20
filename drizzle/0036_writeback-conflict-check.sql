ALTER TABLE "itemSourceLink" ADD COLUMN "remoteCheckRequired" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "itemSourceLink" ADD COLUMN "conflictRemoteVersion" varchar(255);