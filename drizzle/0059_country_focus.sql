ALTER TABLE "item" ADD COLUMN "countryFocus" varchar[];
--> statement-breakpoint
UPDATE "status" SET "searchIndexRebuildPending" = true, "updatedAt" = now();
