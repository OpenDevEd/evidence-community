-- Rollback for 0084_reader-collection-members. The runtime before it has no shared collections, so dropping the
-- tables removes only who a collection was shared with and which invitations made them members. The collections,
-- their records and the invitations OpenScholar keeps are untouched; owners would have to share again after a
-- roll forward.
DROP TABLE IF EXISTS "reader_collection_invitation_use";
DROP TABLE IF EXISTS "reader_collection_member";
