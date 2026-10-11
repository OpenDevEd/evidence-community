-- Lists every digest's stored publications best first: a real abstract, then the score of the journal's standing,
-- references, known institutions and citations, as rankPublications orders a new edition. The likely reviews were
-- stored first, and kept their place once read, so each list on a digest page broke the order it states. Only the
-- order changes: the same publications, with the same metadata. A record that is gone since goes last.
UPDATE "notificationEdition" AS edition SET "publications" = (
	SELECT jsonb_agg(stored.entry ORDER BY measured.abstract DESC NULLS LAST, measured.score DESC NULLS LAST, measured.refs DESC NULLS LAST, stored.entry ->> 'key')
	FROM jsonb_array_elements(edition."publications") AS stored(entry)
	LEFT JOIN LATERAL (
		SELECT length(coalesce(item."abstractNote", '')) >= 200 AS abstract, coalesce(metric.refs, 0) AS refs,
			CASE WHEN record.core THEN 3 ELSE 0 END
				+ CASE WHEN metric.refs >= 10 THEN 2 WHEN metric.refs > 0 THEN 1 ELSE 0 END
				+ CASE WHEN EXISTS (SELECT 1 FROM "itemInstitution" WHERE "itemKey" = item.key) THEN 1 ELSE 0 END
				+ 2 * ln(1 + coalesce(metric.citations, 0))
				- CASE WHEN item."itemType"::text IN ('Dataset', 'ComputerProgram') THEN 1 ELSE 0 END AS score
		FROM item
		LEFT JOIN LATERAL (SELECT max("citedByCount") AS citations, max("referencedWorksCount") AS refs
			FROM "itemCitationMetric" WHERE "itemKey" = item.key) metric ON true
		LEFT JOIN LATERAL (SELECT bool_or("payload" #>> '{primary_location,source,is_core}' = 'true') AS core
			FROM "sourceSnapshot" WHERE "itemKey" = item.key) record ON true
		WHERE item.key = stored.entry ->> 'key'
	) measured ON true
)
WHERE edition."stream" = 'digest' AND jsonb_array_length(edition."publications") > 1;
