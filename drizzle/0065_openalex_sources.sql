CREATE TABLE "openAlexQueryApproval" (
	"sourceConnectionKey" varchar(64) NOT NULL,
	"version" varchar(128) NOT NULL,
	"approval" jsonb NOT NULL,
	CONSTRAINT "openAlexQueryApproval_sourceConnectionKey_version_pk" PRIMARY KEY("sourceConnectionKey","version")
);
--> statement-breakpoint
ALTER TABLE "itemFilePublication" DROP CONSTRAINT "itemFilePublication_item_fk";
--> statement-breakpoint
ALTER TABLE "itemFilePublication" DROP CONSTRAINT "itemFilePublication_parent_fk";
--> statement-breakpoint
ALTER TABLE "openAlexQueryApproval" ADD CONSTRAINT "openAlexQueryApproval_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemFilePublication" ADD CONSTRAINT "itemFilePublication_source_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemFilePublication" ADD CONSTRAINT "itemFilePublication_item_fk" FOREIGN KEY ("itemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemFilePublication" ADD CONSTRAINT "itemFilePublication_parent_fk" FOREIGN KEY ("parentItemKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;