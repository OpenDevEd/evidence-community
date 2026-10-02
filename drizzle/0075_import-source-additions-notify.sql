-- Publications from OpenAlex and OpenScholar collection sources were never
-- eligible for addition emails or digests. They now are once the source has
-- finished its first run, so the first import is still left out.
CREATE OR REPLACE FUNCTION record_notification_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_eligible boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "notificationItem" ("itemKey") VALUES (NEW."key") ON CONFLICT DO NOTHING;
  END IF;
  IF COALESCE(NEW."deleted", 0) <> 0 OR NEW."parentItem" IS NOT NULL
    OR NEW."itemType" IN ('Attachment', 'Note') THEN RETURN NEW;
  END IF;
  SELECT CASE source."provider"
    WHEN 'native' THEN true
    WHEN 'zotero' THEN source."syncCursor" ? 'libraryVersion'
      AND (NOT (source."syncCursor" ? 'pending') OR COALESCE((source."syncCursor"->>'libraryVersion')::bigint, 0) > 0)
    ELSE state."lastSuccessAt" IS NOT NULL
  END INTO source_eligible
  FROM "sourceConnection" source
  LEFT JOIN "sourceSyncState" state ON state."sourceConnectionKey" = source."key"
  WHERE source."key" = NEW."sourceConnectionKey";
  UPDATE "notificationItem" SET "firstPublishedAt" = clock_timestamp(), "eligible" = COALESCE(source_eligible, false)
    WHERE "itemKey" = NEW."key" AND "firstPublishedAt" IS NULL;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Publications such a source added after its first finished run, which the old
-- rule left out. Editions only pick up what arrived after notifications were
-- turned on, so the rest stays out of every email.
UPDATE "notificationItem" SET "eligible" = true
FROM "item", "sourceConnection" source
WHERE "item"."key" = "notificationItem"."itemKey"
  AND source."key" = "item"."sourceConnectionKey"
  AND source."provider" NOT IN ('native', 'zotero')
  AND NOT "notificationItem"."eligible"
  AND "notificationItem"."hourlyEditionId" IS NULL
  AND "notificationItem"."digestEditionId" IS NULL
  AND "notificationItem"."firstPublishedAt" > (
    SELECT min(run."finishedAt") FROM "sourceSyncRun" run
    WHERE run."sourceConnectionKey" = source."key" AND run."status" = 'succeeded'
  );
