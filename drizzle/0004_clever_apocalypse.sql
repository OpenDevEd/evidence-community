CREATE TABLE "sourceSyncRun" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sourceSyncRun_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"sourceConnectionKey" varchar(64) NOT NULL,
	"workerId" varchar(255) NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeatAt" timestamp with time zone DEFAULT now() NOT NULL,
	"finishedAt" timestamp with time zone,
	"result" jsonb,
	"error" text,
	CONSTRAINT "sourceSyncRun_status_valid" CHECK ("sourceSyncRun"."status" IN ('running', 'succeeded', 'failed')),
	CONSTRAINT "sourceSyncRun_terminal_state_valid" CHECK ((
				("sourceSyncRun"."status" = 'running' AND "sourceSyncRun"."finishedAt" IS NULL AND "sourceSyncRun"."result" IS NULL AND "sourceSyncRun"."error" IS NULL)
				OR ("sourceSyncRun"."status" = 'succeeded' AND "sourceSyncRun"."finishedAt" IS NOT NULL AND "sourceSyncRun"."result" IS NOT NULL AND "sourceSyncRun"."error" IS NULL)
				OR ("sourceSyncRun"."status" = 'failed' AND "sourceSyncRun"."finishedAt" IS NOT NULL AND "sourceSyncRun"."result" IS NULL AND "sourceSyncRun"."error" IS NOT NULL)
			))
);
--> statement-breakpoint
CREATE TABLE "sourceSyncState" (
	"sourceConnectionKey" varchar(64) PRIMARY KEY NOT NULL,
	"activeRunId" bigint,
	"leaseOwner" varchar(255),
	"leaseExpiresAt" timestamp with time zone,
	"lastAttemptAt" timestamp with time zone,
	"lastSuccessAt" timestamp with time zone,
	"lastFailureAt" timestamp with time zone,
	"consecutiveFailures" integer DEFAULT 0 NOT NULL,
	"lastError" text,
	"lastResult" jsonb,
	"updatedAt" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sourceSyncState_lease_bundle_valid" CHECK ((
				("sourceSyncState"."leaseOwner" IS NULL AND "sourceSyncState"."leaseExpiresAt" IS NULL AND "sourceSyncState"."activeRunId" IS NULL)
				OR ("sourceSyncState"."leaseOwner" IS NOT NULL AND "sourceSyncState"."leaseExpiresAt" IS NOT NULL AND "sourceSyncState"."activeRunId" IS NOT NULL)
			)),
	CONSTRAINT "sourceSyncState_failures_nonnegative" CHECK ("sourceSyncState"."consecutiveFailures" >= 0)
);
--> statement-breakpoint
ALTER TABLE "sourceSyncRun" ADD CONSTRAINT "sourceSyncRun_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sourceSyncState" ADD CONSTRAINT "sourceSyncState_sourceConnectionKey_sourceConnection_key_fk" FOREIGN KEY ("sourceConnectionKey") REFERENCES "public"."sourceConnection"("key") ON DELETE cascade ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "sourceSyncState" ADD CONSTRAINT "sourceSyncState_activeRunId_sourceSyncRun_id_fk" FOREIGN KEY ("activeRunId") REFERENCES "public"."sourceSyncRun"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "sourceSyncRun_one_running_per_connection" ON "sourceSyncRun" USING btree ("sourceConnectionKey") WHERE "sourceSyncRun"."status" = 'running';--> statement-breakpoint
CREATE INDEX "sourceSyncRun_connection_started_idx" ON "sourceSyncRun" USING btree ("sourceConnectionKey","startedAt");--> statement-breakpoint
CREATE UNIQUE INDEX "sourceSyncState_active_run_unique" ON "sourceSyncState" USING btree ("activeRunId") WHERE "sourceSyncState"."activeRunId" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sourceSyncState_lease_expiry_idx" ON "sourceSyncState" USING btree ("leaseExpiresAt") WHERE "sourceSyncState"."leaseOwner" IS NOT NULL;