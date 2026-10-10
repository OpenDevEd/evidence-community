-- Rollback for 0080_digest-publication-kinds. The runtime before it ignores
-- this table and column, so rolling the release back needs no schema change.
-- Dropping them loses what each likely review was read as, and those records
-- are read again the next time a digest covers them.
DROP TABLE "notificationItemKind";--> statement-breakpoint
ALTER TABLE "notificationEdition" DROP COLUMN "requestedAt";
