-- Who sent an added paper, kept for each review. A paper returned and sent again by someone else has one "addedPaper" row
-- (its first sender's, which the daily suggestion count reads), so the new review couldn't name its sender. Its own
-- table, because review rows reach every Creator and the email is only for Editors and Owners. A review from before it
-- has no row and is named from the paper's row, as before.
CREATE TABLE "itemReviewSender" (
	"reviewId" uuid PRIMARY KEY NOT NULL,
	"name" varchar(255),
	"email" varchar(320),
	"suggested" boolean NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itemReviewSender" ADD CONSTRAINT "itemReviewSender_reviewId_itemReview_id_fk" FOREIGN KEY ("reviewId") REFERENCES "public"."itemReview"("id") ON DELETE cascade ON UPDATE no action;
