-- Rollback for 0087_screening-status-detail. The runtime before it reads no subject or examples; nothing else is lost.
DROP INDEX "itemGrade_latest_idx";--> statement-breakpoint
ALTER TABLE "sourceScreening" DROP COLUMN "subject";
