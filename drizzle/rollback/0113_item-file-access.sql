-- Rollback for 0113_item-file-access. The previous runtime never reads the "fileAccess" column, so it stays, with every
-- record's choice, for when the community rolls forward. That runtime refuses keys it doesn't know in a licence and a
-- record's fields, so a licence's "open" goes from records, drafts and reviews, and a draft's or review's "fileAccess"
-- goes too: those choices, not yet published, are lost.
UPDATE "item" SET "licence" = "licence" - 'open' WHERE "licence"->>'kind' = 'custom';
UPDATE "itemDraft" SET "patch" = ("patch" - 'fileAccess') #- '{licence,open}' WHERE "patch" ? 'fileAccess' OR "patch"->'licence' ? 'open';
UPDATE "itemReview" SET
	"snapshot" = jsonb_set("snapshot", '{records}', (
		SELECT jsonb_agg((record #- '{payload,fileAccess}') #- '{payload,licence,open}' ORDER BY position)
		FROM jsonb_array_elements("snapshot"->'records') WITH ORDINALITY AS records(record, position)
	)),
	"corrections" = COALESCE((
		SELECT jsonb_agg((record #- '{payload,fileAccess}') #- '{payload,licence,open}' ORDER BY position)
		FROM jsonb_array_elements("corrections") WITH ORDINALITY AS corrections(record, position)
	), '[]'::jsonb)
WHERE "snapshot"::text LIKE '%"fileAccess"%' OR "snapshot"::text LIKE '%"open"%'
	OR "corrections"::text LIKE '%"fileAccess"%' OR "corrections"::text LIKE '%"open"%';
