-- Rollback for 0079_digest-silent-editions. The runtime before it ignores this
-- column, so rolling the release back needs no schema change. Dropping it
-- loses which unpublished editions were written by hand for a past period:
-- publish or delete those first, or publishing one later emails its readers.
ALTER TABLE "notificationEdition" DROP COLUMN "silent";
