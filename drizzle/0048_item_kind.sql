ALTER TABLE "itemIdentity" ADD COLUMN "kind" varchar(16) DEFAULT 'imported' NOT NULL;--> statement-breakpoint
ALTER TABLE "itemIdentity" ADD COLUMN "importMethod" varchar(16);--> statement-breakpoint
ALTER TABLE "itemIdentity" ADD CONSTRAINT "itemIdentity_kind_valid" CHECK ("itemIdentity"."kind" IN ('created', 'imported'));--> statement-breakpoint
ALTER TABLE "itemIdentity" ADD CONSTRAINT "itemIdentity_import_method_valid" CHECK ("itemIdentity"."importMethod" IS NULL OR ("itemIdentity"."kind" = 'imported' AND "itemIdentity"."importMethod" IN ('doi', 'file')));
