-- Rollback for 0098_search-engine. A runtime before it searches the engine its configuration names and never reads this
-- column, so rolling the release back needs no change here. Keep the column: a later release reads it again.
--
-- What a rollback means for search: a library that switched to Elasticsearch has no Meilisearch index left, and a runtime
-- before engines were chosen searches only Meilisearch, so its worker rebuilds Meilisearch from PostgreSQL while
-- readers find nothing. After rolling forward again, run `npm run search:index -- --rebuild`: the index of the engine
-- the column names missed every change made during the rollback.
SELECT 1;
