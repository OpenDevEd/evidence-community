-- Rollback for 0083_item-open-access-choice. A runtime before it names the item columns it reads and writes, so it
-- never touches this one and rolling the release back needs no change here. Dropping the column would lose editors'
-- choices, which a later release reads again.
SELECT 1;
