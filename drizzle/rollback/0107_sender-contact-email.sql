-- Rollback for 0107_sender-contact-email. A runtime before it never reads or writes either column, and both are nullable,
-- so rolling the release back needs no change here. Keep the columns: the addresses fill in again only as readers sign in
-- or are checked, and as papers are added.
SELECT 1;
