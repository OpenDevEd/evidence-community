CREATE TABLE "itemFileDraft" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"sourceConnectionKey" varchar(64) DEFAULT 'native' NOT NULL,
	"parentItemKey" varchar(8) NOT NULL,
	"uploadRevision" bigint DEFAULT 1 NOT NULL,
	"objectPath" varchar(1024) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"contentType" varchar(128) NOT NULL,
	"expectedSizeBytes" bigint NOT NULL,
	"expectedSha256" varchar(64) NOT NULL,
	"actualSizeBytes" bigint,
	"actualSha256" varchar(64),
	"extractedText" text,
	"coverObjectPath" varchar(1024),
	"coverWidth" integer,
	"coverHeight" integer,
	"pageCount" integer,
	"readyAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemFileDraft_object_path_unique" UNIQUE("objectPath"),
	CONSTRAINT "itemFileDraft_native_only" CHECK ("itemFileDraft"."sourceConnectionKey" = 'native'),
	CONSTRAINT "itemFileDraft_pdf_only" CHECK ("itemFileDraft"."contentType" = 'application/pdf'),
	CONSTRAINT "itemFileDraft_filename_valid" CHECK (length(btrim("itemFileDraft"."filename")) BETWEEN 1 AND 255),
	CONSTRAINT "itemFileDraft_expected_size_positive" CHECK ("itemFileDraft"."expectedSizeBytes" > 0),
	CONSTRAINT "itemFileDraft_expected_sha256_valid" CHECK ("itemFileDraft"."expectedSha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "itemFileDraft_upload_revision_positive" CHECK ("itemFileDraft"."uploadRevision" >= 1),
	CONSTRAINT "itemFileDraft_ready_bundle_consistent" CHECK ((
				(
					"itemFileDraft"."readyAt" IS NULL
					AND "itemFileDraft"."actualSizeBytes" IS NULL
					AND "itemFileDraft"."actualSha256" IS NULL
					AND "itemFileDraft"."extractedText" IS NULL
					AND "itemFileDraft"."coverObjectPath" IS NULL
					AND "itemFileDraft"."coverWidth" IS NULL
					AND "itemFileDraft"."coverHeight" IS NULL
					AND "itemFileDraft"."pageCount" IS NULL
				)
				OR (
					"itemFileDraft"."readyAt" IS NOT NULL
					AND "itemFileDraft"."actualSizeBytes" = "itemFileDraft"."expectedSizeBytes"
					AND "itemFileDraft"."actualSha256" = "itemFileDraft"."expectedSha256"
					AND "itemFileDraft"."extractedText" IS NOT NULL
					AND "itemFileDraft"."coverObjectPath" IS NOT NULL
					AND "itemFileDraft"."coverWidth" > 0
					AND "itemFileDraft"."coverHeight" > 0
					AND "itemFileDraft"."pageCount" > 0
				)
			))
);
--> statement-breakpoint
CREATE TABLE "itemFilePublication" (
	"itemKey" varchar(8) PRIMARY KEY NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"parentItemKey" varchar(8) NOT NULL,
	"uploadRevision" bigint NOT NULL,
	"revision" bigint NOT NULL,
	"sourceObjectPath" varchar(1024) NOT NULL,
	"sourceCoverObjectPath" varchar(1024) NOT NULL,
	"objectPath" varchar(1024) NOT NULL,
	"publicUrl" varchar(2048) NOT NULL,
	"filename" varchar(255) NOT NULL,
	"contentType" varchar(128) NOT NULL,
	"sizeBytes" bigint NOT NULL,
	"sha256" varchar(64) NOT NULL,
	"coverObjectPath" varchar(1024) NOT NULL,
	"coverPublicUrl" varchar(2048) NOT NULL,
	"coverWidth" integer NOT NULL,
	"coverHeight" integer NOT NULL,
	"pageCount" integer NOT NULL,
	"publishedAt" timestamp with time zone NOT NULL,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "itemFilePublication_object_path_unique" UNIQUE("objectPath"),
	CONSTRAINT "itemFilePublication_pdf_only" CHECK ("itemFilePublication"."contentType" = 'application/pdf'),
	CONSTRAINT "itemFilePublication_revision_positive" CHECK ("itemFilePublication"."revision" >= 1 AND "itemFilePublication"."uploadRevision" >= 1),
	CONSTRAINT "itemFilePublication_size_positive" CHECK ("itemFilePublication"."sizeBytes" > 0),
	CONSTRAINT "itemFilePublication_sha256_valid" CHECK ("itemFilePublication"."sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "itemFilePublication_dimensions_positive" CHECK ("itemFilePublication"."coverWidth" > 0 AND "itemFilePublication"."coverHeight" > 0 AND "itemFilePublication"."pageCount" > 0)
);
--> statement-breakpoint
ALTER TABLE "itemFileDraft" ADD CONSTRAINT "itemFileDraft_item_identity_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."itemIdentity"("key","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemFileDraft" ADD CONSTRAINT "itemFileDraft_parent_identity_fk" FOREIGN KEY ("parentItemKey","sourceConnectionKey") REFERENCES "public"."itemIdentity"("key","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemFilePublication" ADD CONSTRAINT "itemFilePublication_item_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."item"("key","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "itemFilePublication" ADD CONSTRAINT "itemFilePublication_parent_fk" FOREIGN KEY ("parentItemKey","sourceConnectionKey") REFERENCES "public"."item"("key","sourceConnectionKey") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "itemFileDraft_parent_idx" ON "itemFileDraft" USING btree ("parentItemKey");--> statement-breakpoint
CREATE INDEX "itemFilePublication_parent_idx" ON "itemFilePublication" USING btree ("parentItemKey");