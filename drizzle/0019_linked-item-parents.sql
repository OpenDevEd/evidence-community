ALTER TABLE "item" DROP CONSTRAINT "item_parent_source_fk";
--> statement-breakpoint
ALTER TABLE "item" ADD CONSTRAINT "item_parent_fk" FOREIGN KEY ("parentItem") REFERENCES "public"."item"("key") ON DELETE no action ON UPDATE no action;