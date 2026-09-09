CREATE TABLE "itemFileRemoval" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itemPublishingChoice" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"choice" jsonb NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "itemReview" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"itemKey" varchar(8) NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"submittedBy" text NOT NULL,
	"submittedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"snapshot" jsonb NOT NULL,
	"corrections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"resolvedBy" text,
	"resolvedAt" timestamp with time zone,
	"note" text,
	CONSTRAINT "itemReview_state_valid" CHECK ("itemReview"."state" IN ('pending', 'published', 'returned', 'withdrawn')),
	CONSTRAINT "itemReview_resolution_valid" CHECK (("itemReview"."state" = 'pending' AND "itemReview"."resolvedAt" IS NULL AND "itemReview"."resolvedBy" IS NULL) OR ("itemReview"."state" <> 'pending' AND "itemReview"."resolvedAt" IS NOT NULL AND "itemReview"."resolvedBy" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "itemReviewFile" (
	"reviewId" uuid NOT NULL,
	"itemKey" varchar(8) NOT NULL,
	"objectPath" text,
	"coverObjectPath" text,
	"file" jsonb,
	CONSTRAINT "itemReviewFile_reviewId_itemKey_pk" PRIMARY KEY("reviewId","itemKey"),
	CONSTRAINT "itemReviewFile_paths_match" CHECK (("itemReviewFile"."file" IS NULL AND "itemReviewFile"."objectPath" IS NULL AND "itemReviewFile"."coverObjectPath" IS NULL) OR ("itemReviewFile"."file" IS NOT NULL AND "itemReviewFile"."objectPath" IS NOT NULL AND "itemReviewFile"."coverObjectPath" IS NOT NULL AND "itemReviewFile"."file"->>'objectPath' = "itemReviewFile"."objectPath" AND "itemReviewFile"."file"->>'coverObjectPath' = "itemReviewFile"."coverObjectPath"))
);
--> statement-breakpoint
ALTER TABLE "itemFileRemoval" ADD CONSTRAINT "itemFileRemoval_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemPublishingChoice" ADD CONSTRAINT "itemPublishingChoice_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemReview" ADD CONSTRAINT "itemReview_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemReviewFile" ADD CONSTRAINT "itemReviewFile_reviewId_itemReview_id_fk" FOREIGN KEY ("reviewId") REFERENCES "public"."itemReview"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemReviewFile" ADD CONSTRAINT "itemReviewFile_itemKey_itemIdentity_key_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."itemIdentity"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "itemReview_one_pending" ON "itemReview" USING btree ("itemKey") WHERE "itemReview"."state" = 'pending';