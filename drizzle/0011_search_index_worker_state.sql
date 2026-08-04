CREATE TABLE "searchIndexWorker" (
	"workerId" varchar(255) PRIMARY KEY NOT NULL,
	"instanceId" varchar(64) NOT NULL,
	"stage" text DEFAULT 'starting' NOT NULL,
	"startedAt" timestamp with time zone DEFAULT now() NOT NULL,
	"heartbeatAt" timestamp with time zone DEFAULT now() NOT NULL,
	"stoppedAt" timestamp with time zone,
	"currentEventCount" integer DEFAULT 0 NOT NULL,
	"currentTaskUid" bigint,
	"currentBatchUid" bigint,
	"currentBatchProgress" real,
	"lastCompletedAt" timestamp with time zone,
	"lastError" text,
	CONSTRAINT "searchIndexWorker_stage_valid" CHECK ("searchIndexWorker"."stage" IN ('starting', 'idle', 'projecting', 'waiting', 'indexing', 'retrying', 'stopping', 'stopped')),
	CONSTRAINT "searchIndexWorker_event_count_nonnegative" CHECK ("searchIndexWorker"."currentEventCount" >= 0),
	CONSTRAINT "searchIndexWorker_progress_valid" CHECK ("searchIndexWorker"."currentBatchProgress" IS NULL OR ("searchIndexWorker"."currentBatchUid" IS NOT NULL AND "searchIndexWorker"."currentTaskUid" IS NOT NULL AND "searchIndexWorker"."stage" = 'indexing' AND "searchIndexWorker"."currentBatchProgress" >= 0 AND "searchIndexWorker"."currentBatchProgress" <= 100)),
	CONSTRAINT "searchIndexWorker_work_state_valid" CHECK ((
				("searchIndexWorker"."stage" IN ('starting', 'idle', 'retrying', 'stopping', 'stopped') AND "searchIndexWorker"."currentEventCount" = 0 AND "searchIndexWorker"."currentTaskUid" IS NULL AND "searchIndexWorker"."currentBatchUid" IS NULL AND "searchIndexWorker"."currentBatchProgress" IS NULL)
				OR ("searchIndexWorker"."stage" = 'projecting' AND "searchIndexWorker"."currentEventCount" > 0 AND "searchIndexWorker"."currentTaskUid" IS NULL AND "searchIndexWorker"."currentBatchUid" IS NULL AND "searchIndexWorker"."currentBatchProgress" IS NULL)
				OR ("searchIndexWorker"."stage" IN ('waiting', 'indexing') AND "searchIndexWorker"."currentEventCount" > 0 AND "searchIndexWorker"."currentTaskUid" IS NOT NULL)
			)),
	CONSTRAINT "searchIndexWorker_stopped_state_valid" CHECK (("searchIndexWorker"."stage" = 'stopped' AND "searchIndexWorker"."stoppedAt" IS NOT NULL) OR ("searchIndexWorker"."stage" <> 'stopped' AND "searchIndexWorker"."stoppedAt" IS NULL))
);
--> statement-breakpoint
CREATE INDEX "searchIndexWorker_heartbeat_idx" ON "searchIndexWorker" USING btree ("heartbeatAt");--> statement-breakpoint
CREATE UNIQUE INDEX "searchIndexWorker_instance_unique" ON "searchIndexWorker" USING btree ("instanceId");