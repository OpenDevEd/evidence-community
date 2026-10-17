COPY (
  -- Only records a reader can find: not deleted, not hidden by a tag ($1, the library's hidden tags) or by its screening.
  WITH shown AS (SELECT i."key" FROM "item" i WHERE coalesce(i."deleted", 0) <> 1
    AND NOT EXISTS (SELECT 1 FROM "itemToTag" t WHERE t."itemKey" = i."key" AND lower(t."tagName") = ANY($1))
    AND NOT EXISTS (SELECT 1 FROM "itemReading" r WHERE r."itemKey" = i."key" AND r."screenedOut")),
  w AS (SELECT DISTINCT ON (l."itemKey") l."itemKey", l."sourceRecordKey" FROM "itemSourceLink" l JOIN shown ON shown."key" = l."itemKey" WHERE l."sourceRecordKey" ~ '^W[0-9]+$' ORDER BY l."itemKey", l."sourceRecordKey")
  SELECT DISTINCT r."itemKey", w."itemKey" FROM "sourceReference" r JOIN shown ON shown."key" = r."itemKey" JOIN w ON w."sourceRecordKey" = r."targetRecordKey" WHERE r."itemKey" <> w."itemKey"
) TO STDOUT WITH (FORMAT csv);
