DROP INDEX "outbox_unprocessed_idx";--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "nextAttemptAt" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "leaseOwner" varchar(255);--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "leaseExpiresAt" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "outbox" ADD COLUMN "deadLetteredAt" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "outbox_lease_expiry_idx" ON "outbox" USING btree ("leaseExpiresAt") WHERE "outbox"."leaseOwner" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outbox_unprocessed_idx" ON "outbox" USING btree ("nextAttemptAt","id") WHERE "outbox"."processedAt" IS NULL AND "outbox"."deadLetteredAt" IS NULL;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_attempts_nonnegative" CHECK ("outbox"."attempts" >= 0);--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_lease_bundle_valid" CHECK ((
				("outbox"."leaseOwner" IS NULL AND "outbox"."leaseExpiresAt" IS NULL)
				OR ("outbox"."leaseOwner" IS NOT NULL AND "outbox"."leaseExpiresAt" IS NOT NULL)
			));--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_terminal_state_valid" CHECK (NOT ("outbox"."processedAt" IS NOT NULL AND "outbox"."deadLetteredAt" IS NOT NULL)
				AND ("outbox"."processedAt" IS NULL AND "outbox"."deadLetteredAt" IS NULL
					OR ("outbox"."leaseOwner" IS NULL AND "outbox"."leaseExpiresAt" IS NULL)));