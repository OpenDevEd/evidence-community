-- Rollback: keep the column. Older runtimes ignore it, so rolling the
-- application back needs no schema change. A full reversal drops
-- sourceSyncState.runRequestedAt; it only holds pending run requests.
ALTER TABLE "sourceSyncState" ADD COLUMN "runRequestedAt" timestamp with time zone;
