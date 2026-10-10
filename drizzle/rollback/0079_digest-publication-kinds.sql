-- Rollback for 0079_digest-publication-kinds. The runtime before it ignores
-- this table, so rolling the release back needs no schema change. Dropping it
-- loses what each likely review was read as, and those records are read again
-- the next time a digest covers them.
DROP TABLE "notificationItemKind";
