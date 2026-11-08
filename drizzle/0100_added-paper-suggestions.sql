-- Papers suggested by someone outside the community's team (OpenDevEd/new-el#777): marked, so each person and the
-- community as a whole can be held to a daily number of them.
ALTER TABLE "addedPaper" ADD COLUMN "suggested" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "addedPaper_suggested_idx" ON "addedPaper" ("addedAt") WHERE "suggested";--> statement-breakpoint
CREATE INDEX "addedPaper_added_by_idx" ON "addedPaper" ("addedBy", "addedAt");
