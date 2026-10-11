-- Rollback for 0081_digest-ranked-order. It changes only the order of each digest's stored publications, which the
-- runtime before it lists as stored, so rolling the release back needs no change here. The earlier order (likely
-- reviews first) is not kept and cannot be rebuilt; nothing is lost but that order.
SELECT 1;
