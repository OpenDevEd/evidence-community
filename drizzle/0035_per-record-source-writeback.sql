ALTER TABLE "sourceConnection" DROP CONSTRAINT "sourceConnection_default_writeback_remote";--> statement-breakpoint
DROP INDEX "itemSourceLink_one_writeback_per_item";--> statement-breakpoint
DROP INDEX "sourceConnection_one_default_writeback";--> statement-breakpoint
ALTER TABLE "sourceConnection" DROP COLUMN "defaultWriteback";