-- A record with a real DOI can't be deleted, only withdrawn (OpenDevEd/new-el#893): it leaves the community like an
-- unpublished one, its page becomes a tombstone that says when and why, and Crossref and Zenodo are told. These two
-- columns say a removed record was withdrawn, and why, in words its tombstone shows. Its attachments withdrawn with it
-- carry the same moment, so restoring the record brings them back. Every existing record has neither.
-- Rollback: drizzle/rollback/0111_item-withdrawal.sql.
ALTER TABLE "item" ADD COLUMN "withdrawnAt" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "item" ADD COLUMN "withdrawalReason" text;
