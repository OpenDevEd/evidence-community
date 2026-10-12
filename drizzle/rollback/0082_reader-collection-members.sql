-- Rollback for 0082_reader-collection-members. The runtime before it has no shared collections, so dropping the
-- table removes only who a collection was shared with. The collections, their records and the invitations
-- OpenScholar keeps are untouched; owners would have to share again after a roll forward.
DROP TABLE IF EXISTS "reader_collection_member";
