-- Rollback for 0082_item-open-access-lookup. A runtime before it never reads the table, so rolling the release back
-- needs no change here. Dropping it loses only lookups the next run makes again.
SELECT 1;
