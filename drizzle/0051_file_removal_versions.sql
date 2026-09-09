ALTER TABLE "itemFileRemoval" ADD COLUMN "id" uuid DEFAULT gen_random_uuid() NOT NULL;--> statement-breakpoint
ALTER TABLE "itemReviewFile" ADD COLUMN "removalId" uuid;