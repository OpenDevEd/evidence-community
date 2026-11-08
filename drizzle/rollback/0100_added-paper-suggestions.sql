-- Rollback for 0100_added-paper-suggestions. A runtime before it never writes "suggested", and a new column with a
-- default doesn't stop it inserting rows, so rolling the release back needs no change here. Keep the column: the
-- suggestions it marks stay told apart when the release returns.
SELECT 1;
