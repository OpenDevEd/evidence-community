-- Rollback for 0108_sitemap-records-index. An older runtime never relies on the index, so rolling the release back needs
-- no change; drop it only to reclaim its space.
DROP INDEX IF EXISTS "item_sitemap_key_idx";
