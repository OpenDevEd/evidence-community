-- Rollback for 0078_digest-editorial. The runtime before it ignores these
-- columns and the event table, so rolling the release back needs no schema
-- change: digests then go out as AI writes them, and drafts wait unseen.
-- Dropping them loses every editor's note, who checked each digest, each
-- edition's history, and whether a draft was waiting for review.
DROP TABLE "notificationEditionEvent";--> statement-breakpoint
ALTER TABLE "notificationEdition" DROP COLUMN "draftRevision";--> statement-breakpoint
ALTER TABLE "notificationEdition" DROP COLUMN "reviewRequestedAt";--> statement-breakpoint
ALTER TABLE "notificationEdition" DROP COLUMN "note";--> statement-breakpoint
ALTER TABLE "notificationEdition" DROP COLUMN "checkedBy";
