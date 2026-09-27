-- Rollback: keep these columns. They are nullable or defaulted, and older
-- runtimes neither read nor write them, so rolling the application back needs
-- no schema change. An older runtime leaves lastErrorCode as it was, so before
-- upgrading again run: UPDATE "sourceSyncState" SET "lastErrorCode" = NULL; A full reversal drops outbox_source_sync_run_idx, the
-- outbox_sourceSyncRunId_sourceSyncRun_id_fk constraint, outbox.sourceSyncRunId,
-- sourceSyncRun.recordsDone/recordsTotal/recordsFrom/recordsFromAt and
-- sourceSyncState.lastErrorCode/lastChangedRecords; no library data lives in them.
ALTER TABLE "outbox" ADD COLUMN "sourceSyncRunId" bigint;--> statement-breakpoint
ALTER TABLE "sourceSyncRun" ADD COLUMN "recordsDone" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "sourceSyncRun" ADD COLUMN "recordsTotal" integer;--> statement-breakpoint
ALTER TABLE "sourceSyncRun" ADD COLUMN "recordsFrom" integer;--> statement-breakpoint
ALTER TABLE "sourceSyncRun" ADD COLUMN "recordsFromAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sourceSyncState" ADD COLUMN "lastErrorCode" text;--> statement-breakpoint
ALTER TABLE "sourceSyncState" ADD COLUMN "lastChangedRecords" integer;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_sourceSyncRunId_sourceSyncRun_id_fk" FOREIGN KEY ("sourceSyncRunId") REFERENCES "public"."sourceSyncRun"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "outbox_source_sync_run_idx" ON "outbox" USING btree ("sourceSyncRunId") WHERE "outbox"."sourceSyncRunId" IS NOT NULL;