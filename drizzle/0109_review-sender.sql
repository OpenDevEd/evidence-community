-- Who sent an added paper, kept on each review. A paper returned and sent again by someone else has one "addedPaper" row
-- (its first sender's, which the daily suggestion count reads), so the new review couldn't name its sender. A review
-- from before this column has none and is named from the paper's row, as before.
ALTER TABLE "itemReview" ADD COLUMN "sender" jsonb;
