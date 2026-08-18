ALTER TABLE "sourceConnection" DROP CONSTRAINT "sourceConnection_default_writeback_remote";--> statement-breakpoint
ALTER TABLE "sourceConnection" DROP COLUMN "credentialRef";--> statement-breakpoint
ALTER TABLE "sourceConnection" ADD CONSTRAINT "sourceConnection_default_writeback_remote" CHECK (NOT "sourceConnection"."defaultWriteback" OR (
				"sourceConnection"."provider" <> 'native'
					AND "sourceConnection"."status" <> 'removed'
			));