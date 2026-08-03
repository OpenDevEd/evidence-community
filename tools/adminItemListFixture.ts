import type { Client } from "pg";

export async function createAdminItemListFixture(
	client: Client,
	rowCount: number,
) {
	await client.query(`
		CREATE TEMP TABLE "adminItemListProjection"
		(LIKE public."adminItemListProjection" INCLUDING ALL)
		ON COMMIT DROP
	`);
	await client.query(
		`INSERT INTO "adminItemListProjection" (
			key, "itemType", title, "titleSort", creators, "creatorNames",
			date, year, "sourceConnectionKey", revision, state, "fileState",
			"updatedAt", "dateAdded", collections, tags, "pageCount", "searchText"
		)
		SELECT
			'b' || lpad(to_hex(value), 7, '0'),
			CASE value % 4 WHEN 0 THEN 'Book' WHEN 1 THEN 'JournalArticle' WHEN 2 THEN 'Report' ELSE 'Document' END,
			'Teacher evidence record ' || lpad(value::text, 7, '0'),
			'teacher evidence record ' || lpad(value::text, 7, '0'),
			jsonb_build_array(jsonb_build_object('creatorType', 'author', 'name', 'Author ' || (value % 5000))),
			ARRAY['Author ' || (value % 5000)],
			(2000 + value % 26)::text,
			CASE WHEN value % 11 = 0 THEN NULL ELSE 2000 + value % 26 END,
			CASE value % 5 WHEN 0 THEN 'native' ELSE 'source-' || (value % 5) END,
			1 + value % 20,
			CASE value % 12 WHEN 0 THEN 'draft' WHEN 1 THEN 'edited' WHEN 2 THEN 'deleted' ELSE 'published' END,
			CASE value % 4 WHEN 0 THEN 'none' WHEN 1 THEN 'processing' WHEN 2 THEN 'staged' ELSE 'published' END,
			timestamptz '2026-07-31 00:00:00+00' - ((value / 25) || ' seconds')::interval,
			timestamptz '2020-01-01 00:00:00+00' + (value || ' seconds')::interval,
			ARRAY['collection-' || (value % 250)],
			ARRAY['tag-' || (value % 1000)],
			CASE WHEN value % 4 = 0 THEN NULL ELSE 1 + value % 800 END,
			'Teacher evidence record ' || value || ' Author ' || (value % 5000) || ' tag-' || (value % 1000)
		FROM generate_series(1, $1) value`,
		[rowCount],
	);
	await client.query('ANALYZE "adminItemListProjection"');
}
