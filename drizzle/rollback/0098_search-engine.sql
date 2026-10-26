-- Rollback for 0098_search-engine. A runtime before it searches the engine its configuration names and never reads this
-- column, so rolling the release back needs no change here. Keep the column: a later release reads it again.
--
-- What a rollback means for search: a library still on Meilisearch notices nothing. A library that switched to
-- Elasticsearch has no Meilisearch index left, and a runtime before engines were chosen searches only Meilisearch, so
-- its worker refills Meilisearch from PostgreSQL while readers find only the records indexed so far. Rolling forward
-- rebuilds the Elasticsearch index on its own: the projection signature the older worker stored differs from it.
SELECT 1;
