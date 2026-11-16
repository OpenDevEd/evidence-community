-- Rollback for 0109_review-sender. A runtime before it never reads or writes the column, and it is nullable, so rolling
-- the release back needs no change here. Keep the column: dropping it would lose who sent each review.
SELECT 1;
