CREATE TABLE "itemLink" (
	"fromKey" varchar(8) NOT NULL,
	"toKey" varchar(8) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"origin" varchar(72) NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemLink_fromKey_toKey_kind_pk" PRIMARY KEY("fromKey","toKey","kind"),
	CONSTRAINT "itemLink_not_self" CHECK ("itemLink"."fromKey" <> "itemLink"."toKey"),
	CONSTRAINT "itemLink_kind_valid" CHECK ("itemLink"."kind" in ('cites', 'related')),
	CONSTRAINT "itemLink_origin_valid" CHECK ("itemLink"."origin" = 'manual' or "itemLink"."origin" ~ '^source:[a-z][a-z0-9]*(?:-[a-z0-9]+)*$')
);
--> statement-breakpoint
ALTER TABLE "itemLink" ADD CONSTRAINT "itemLink_fromKey_item_key_fk" FOREIGN KEY ("fromKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemLink" ADD CONSTRAINT "itemLink_toKey_item_key_fk" FOREIGN KEY ("toKey") REFERENCES "public"."item"("key") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itemLink_to_idx" ON "itemLink" USING btree ("toKey","kind");--> statement-breakpoint
CREATE INDEX "itemLink_origin_idx" ON "itemLink" USING btree ("origin","fromKey");--> statement-breakpoint
UPDATE "item" SET "relations" = "relations" - 'cites' - 'citedBy' WHERE "relations" ?| array['cites','citedBy'];
