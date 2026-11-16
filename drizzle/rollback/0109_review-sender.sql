-- Rollback for 0109_review-sender. A runtime before it never reads or writes the table, so rolling the release back needs
-- no change here. Keep the table: dropping it would lose who sent each review.
SELECT 1;
