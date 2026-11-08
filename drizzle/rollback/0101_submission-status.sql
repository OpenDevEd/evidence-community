-- Rollback for 0101_submission-status. A runtime before it never fills or reads "submissionStatusDelivery", so
-- rolling the release back needs no change here. Keep the table: changes still waiting in it are sent when the
-- release returns.
SELECT 1;
