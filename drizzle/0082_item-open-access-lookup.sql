-- What OpenAlex says about the DOI a record shows, for records no OpenAlex work was imported for, so the record can
-- say whether it is open access (OpenDevEd/new-el#580). Records imported from OpenAlex read it from their stored work.
-- Rollback: drizzle/rollback/0082_item-open-access-lookup.sql.
CREATE TABLE "itemOpenAccessLookup" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"itemRevision" bigint NOT NULL,
	"doi" varchar,
	"isOpenAccess" boolean,
	"checkedAt" timestamp with time zone NOT NULL,
	"lookedAt" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "itemOpenAccessLookup" ADD CONSTRAINT "itemOpenAccessLookup_item_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;