COPY (
  -- Only records a reader can find: not deleted, not hidden by a tag ($1, the library's hidden tags) or by its screening.
  WITH shown AS (SELECT i."key" FROM "item" i WHERE coalesce(i."deleted", 0) <> 1
    AND NOT EXISTS (SELECT 1 FROM "itemToTag" t WHERE t."itemKey" = i."key" AND lower(t."tagName") = ANY($1))
    AND NOT EXISTS (SELECT 1 FROM "itemReading" r WHERE r."itemKey" = i."key" AND r."screenedOut")),
  w AS (SELECT DISTINCT ON (l."itemKey") l."itemKey", l."sourceRecordKey" FROM "itemSourceLink" l JOIN shown ON shown."key" = l."itemKey" WHERE l."sourceRecordKey" ~ '^W[0-9]+$' ORDER BY l."itemKey", l."sourceRecordKey"),
  e AS (SELECT DISTINCT r."itemKey" AS citing, w."itemKey" AS cited FROM "sourceReference" r JOIN shown ON shown."key" = r."itemKey" JOIN w ON w."sourceRecordKey" = r."targetRecordKey" WHERE r."itemKey" <> w."itemKey"),
  n AS (SELECT citing AS k FROM e UNION SELECT cited FROM e)
  SELECT i."key",
    left(regexp_replace(coalesce(i."title", ''), '\s+', ' ', 'g'), 200),
    coalesce(nullif(c.creator ->> 'lastName', ''), substring(c.creator ->> 'name' from '(\S+)\s*$'), ''),
    coalesce(jsonb_array_length(i."creators"), 0),
    coalesce((SELECT t."topicId" FROM "sourceTopicAssignment" t WHERE t."itemKey" = i."key" AND t."primary" LIMIT 1), '')
  FROM n JOIN "item" i ON i."key" = n.k
  LEFT JOIN LATERAL (SELECT x AS creator FROM jsonb_array_elements(coalesce(i."creators", '[]'::jsonb)) WITH ORDINALITY AS t(x, p) ORDER BY (x ->> 'creatorType' = 'author') DESC NULLS LAST, p LIMIT 1) c ON true
) TO STDOUT WITH (FORMAT csv);
