-- Rollback for 0076_digest-pause-state. The runtime before it ignores both
-- columns, so rolling the release back needs no schema change. Dropping them
-- forgets that the library was paused and where its digests may start: a
-- paused library then sends its overdue digest, and additions older than a
-- month can return to a digest.
ALTER TABLE "notificationState" DROP COLUMN "digestPaused";--> statement-breakpoint
ALTER TABLE "notificationState" DROP COLUMN "digestFloor";
