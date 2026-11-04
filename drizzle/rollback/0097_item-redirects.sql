-- Rollback for 0097_item-redirects. A runtime before it reads Meilisearch and never this table, so rolling the
-- release back needs no change here. Keep the table: once a library's Meilisearch is gone, its redirects live only here.
SELECT 1;
