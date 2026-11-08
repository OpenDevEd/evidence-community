-- Openscholar keeps each person's submitted papers and where they stand (OpenDevEd/new-el#778). When a reviewer
-- approves or returns an added paper, or its sender withdraws it, a row here sends the change to Openscholar,
-- retried until it answers.
CREATE TABLE "submissionStatusDelivery" (
	"itemKey" varchar(64) PRIMARY KEY NOT NULL,
	"generation" bigint DEFAULT 1 NOT NULL,
	"payload" jsonb,
	"revision" bigint NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"nextAttemptAt" timestamp with time zone DEFAULT now(),
	"leaseToken" text,
	"leaseExpiresAt" timestamp with time zone,
	"lastError" text
);--> statement-breakpoint
CREATE INDEX "submissionStatusDelivery_pending_idx" ON "submissionStatusDelivery" ("nextAttemptAt") WHERE "nextAttemptAt" IS NOT NULL;
