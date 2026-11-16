-- The records the sitemaps list, in key order. The predicate repeats `sitemapRecordCondition`
-- clause for clause, so PostgreSQL works out "has an abstract" once when a record is written instead of running the
-- regular expression over every abstract on every sitemap request (16 s on a 270,000-record community). The test in
-- tests/integration/public-library-status.test.ts fails if the query and this predicate drift apart.
CREATE INDEX IF NOT EXISTS "item_sitemap_key_idx" ON "item" ("key")
WHERE coalesce("deleted", 0) <> 1
	AND coalesce("parentItem", '') = ''
	AND regexp_replace(coalesce("abstractNote", ''), U&'<[^>]*>|&nbsp;|&#160;|[[:space:]]|\00A0', '', 'g') <> '';
