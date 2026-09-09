CREATE TABLE "notificationDelivery" (
	"messageKey" text PRIMARY KEY NOT NULL,
	"subscriberId" uuid NOT NULL,
	"editionId" uuid,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone DEFAULT now(),
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"sendStartedAt" timestamp with time zone,
	"sentAt" timestamp with time zone,
	"lastError" text
);
--> statement-breakpoint
CREATE TABLE "notificationEdition" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"stream" text NOT NULL,
	"windowStart" timestamp with time zone NOT NULL,
	"windowEnd" timestamp with time zone NOT NULL,
	"publications" jsonb NOT NULL,
	"title" text,
	"summary" text,
	"markdown" text,
	"publishedAt" timestamp with time zone,
	"model" text,
	"reasoning" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone DEFAULT now(),
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"lastError" text
);
--> statement-breakpoint
CREATE TABLE "notificationItem" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"firstPublishedAt" timestamp with time zone,
	"eligible" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notificationState" (
	"singleton" boolean PRIMARY KEY DEFAULT true NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"enabledAt" timestamp with time zone,
	"hourlyThrough" timestamp with time zone,
	"weeklyThrough" timestamp with time zone,
	"nextWeeklyAt" timestamp with time zone,
	"schedule" text NOT NULL,
	CONSTRAINT "notificationState_singleton" CHECK ("notificationState"."singleton" = true)
);
--> statement-breakpoint
CREATE TABLE "notificationSubscriber" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"token" text NOT NULL,
	"weekly" boolean NOT NULL,
	"instant" boolean NOT NULL,
	"confirmedAt" timestamp with time zone,
	"confirmationRequestedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"confirmationExpiresAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notificationDelivery" ADD CONSTRAINT "notificationDelivery_subscriberId_notificationSubscriber_id_fk" FOREIGN KEY ("subscriberId") REFERENCES "public"."notificationSubscriber"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificationDelivery" ADD CONSTRAINT "notificationDelivery_editionId_notificationEdition_id_fk" FOREIGN KEY ("editionId") REFERENCES "public"."notificationEdition"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notificationDelivery_pending_idx" ON "notificationDelivery" USING btree ("nextAttemptAt") WHERE "notificationDelivery"."status" = 'queued';--> statement-breakpoint
CREATE UNIQUE INDEX "notificationEdition_window_unique" ON "notificationEdition" USING btree ("stream","windowEnd");--> statement-breakpoint
CREATE INDEX "notificationEdition_pending_idx" ON "notificationEdition" USING btree ("nextAttemptAt") WHERE "notificationEdition"."publishedAt" IS NULL;--> statement-breakpoint
CREATE INDEX "notificationItem_first_publication_idx" ON "notificationItem" USING btree ("firstPublishedAt") WHERE "notificationItem"."eligible" = true;--> statement-breakpoint
CREATE UNIQUE INDEX "notificationSubscriber_email_unique" ON "notificationSubscriber" USING btree ("email");--> statement-breakpoint
CREATE UNIQUE INDEX "notificationSubscriber_token_unique" ON "notificationSubscriber" USING btree ("token");
--> statement-breakpoint
CREATE FUNCTION record_notification_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_eligible boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "notificationItem" ("itemKey") VALUES (NEW."key") ON CONFLICT DO NOTHING;
  END IF;
  IF COALESCE(NEW."deleted", 0) <> 0 OR NEW."parentItem" IS NOT NULL
    OR NEW."itemType" IN ('Attachment', 'Note') THEN RETURN NEW;
  END IF;
  SELECT "provider" = 'native' OR (
    "provider" = 'zotero' AND "syncCursor" ? 'libraryVersion'
    AND (NOT ("syncCursor" ? 'pending') OR COALESCE(("syncCursor"->>'libraryVersion')::bigint, 0) > 0)
  ) INTO source_eligible FROM "sourceConnection" WHERE "key" = NEW."sourceConnectionKey";
  UPDATE "notificationItem" SET "firstPublishedAt" = clock_timestamp(), "eligible" = COALESCE(source_eligible, false)
    WHERE "itemKey" = NEW."key" AND "firstPublishedAt" IS NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER record_notification_publication AFTER INSERT OR UPDATE ON "item"
FOR EACH ROW EXECUTE FUNCTION record_notification_publication();
