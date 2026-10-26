-- Rollback for 0098_search-engine. A runtime before it searches the engine its configuration names and never reads this
-- column, so rolling the release back needs no change here. Keep the column: a later release reads it again.
SELECT 1;
