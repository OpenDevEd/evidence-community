-- Rollback for 0096_computed-cache. A runtime before it caches in Meilisearch and never reads this table, so rolling
-- the release back needs no change here. Dropping it loses only values the next request computes again.
SELECT 1;
