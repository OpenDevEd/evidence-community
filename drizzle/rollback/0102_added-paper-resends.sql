-- Rollback for 0102_added-paper-resends. A runtime before it never reads or writes "resendRequestIds", and a new column
-- with a default doesn't stop it inserting rows, so rolling the release back needs no change here. Keep the column: the
-- requests it records still count when the release returns.
SELECT 1;
