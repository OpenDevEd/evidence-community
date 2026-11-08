-- Rollback for 0099_added-papers. A runtime before it never reads "addedPaper" and never syncs the 'added' provider, so
-- rolling the release back needs no change here: the Added papers records stay as they are, published or waiting in
-- review, and stop being refreshed from OpenAlex until the release returns. Keep the table, the connection row and the
-- constraint: dropping the constraint's 'added' case fails while the row exists.
SELECT 1;
