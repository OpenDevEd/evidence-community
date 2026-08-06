CREATE TABLE "sourceWritebackJob" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sourceWritebackJob_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"itemKey" varchar(8) NOT NULL,
	"sourceConnectionKey" varchar(64) NOT NULL,
	"operation" text NOT NULL,
	"canonicalRevision" bigint NOT NULL,
	"dirtyFields" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"idempotencyKey" varchar(255) NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL,
	"leaseOwner" varchar(255),
	"leaseExpiresAt" timestamp with time zone,
	"createdAt" timestamp with time zone DEFAULT now() NOT NULL,
	"processedAt" timestamp with time zone,
	"deadLetteredAt" timestamp with time zone,
	"superseded" boolean DEFAULT false NOT NULL,
	"completedSourceRecordKey" varchar(512),
	"completedRemoteVersion" varchar(255),
	CONSTRAINT "sourceWritebackJob_idempotency_unique" UNIQUE("idempotencyKey"),
	CONSTRAINT "sourceWritebackJob_revision_unique" UNIQUE("itemKey","sourceConnectionKey","canonicalRevision","operation"),
	CONSTRAINT "sourceWritebackJob_operation_valid" CHECK ("sourceWritebackJob"."operation" IN ('upsert', 'delete')),
	CONSTRAINT "sourceWritebackJob_revision_positive" CHECK ("sourceWritebackJob"."canonicalRevision" >= 1),
	CONSTRAINT "sourceWritebackJob_dirty_fields_array" CHECK (jsonb_typeof("sourceWritebackJob"."dirtyFields") = 'array'),
	CONSTRAINT "sourceWritebackJob_attempts_nonnegative" CHECK ("sourceWritebackJob"."attempts" >= 0),
	CONSTRAINT "sourceWritebackJob_lease_bundle_valid" CHECK ((
				("sourceWritebackJob"."leaseOwner" IS NULL AND "sourceWritebackJob"."leaseExpiresAt" IS NULL)
				OR ("sourceWritebackJob"."leaseOwner" IS NOT NULL AND "sourceWritebackJob"."leaseExpiresAt" IS NOT NULL)
			)),
	CONSTRAINT "sourceWritebackJob_terminal_state_valid" CHECK (NOT ("sourceWritebackJob"."processedAt" IS NOT NULL AND "sourceWritebackJob"."deadLetteredAt" IS NOT NULL)
				AND (NOT "sourceWritebackJob"."superseded" OR "sourceWritebackJob"."processedAt" IS NOT NULL)
				AND ("sourceWritebackJob"."processedAt" IS NULL AND "sourceWritebackJob"."deadLetteredAt" IS NULL
					OR ("sourceWritebackJob"."leaseOwner" IS NULL AND "sourceWritebackJob"."leaseExpiresAt" IS NULL)))
);
--> statement-breakpoint
ALTER TABLE "sourceConnection" ADD COLUMN "defaultWriteback" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceWritebackJob" ADD CONSTRAINT "sourceWritebackJob_link_fk" FOREIGN KEY ("itemKey","sourceConnectionKey") REFERENCES "public"."itemSourceLink"("itemKey","sourceConnectionKey") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
CREATE INDEX "sourceWritebackJob_unprocessed_idx" ON "sourceWritebackJob" USING btree ("nextAttemptAt","id") WHERE "sourceWritebackJob"."processedAt" IS NULL AND "sourceWritebackJob"."deadLetteredAt" IS NULL;--> statement-breakpoint
CREATE INDEX "sourceWritebackJob_link_idx" ON "sourceWritebackJob" USING btree ("itemKey","sourceConnectionKey");--> statement-breakpoint
CREATE UNIQUE INDEX "sourceConnection_one_default_writeback" ON "sourceConnection" USING btree ("defaultWriteback") WHERE "sourceConnection"."defaultWriteback" = true;--> statement-breakpoint
ALTER TABLE "sourceConnection" ADD CONSTRAINT "sourceConnection_default_writeback_remote" CHECK (NOT "sourceConnection"."defaultWriteback" OR (
				"sourceConnection"."provider" <> 'native'
				AND "sourceConnection"."status" <> 'removed'
				AND "sourceConnection"."credentialRef" IS NOT NULL
			));
