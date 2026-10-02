-- Rollback for 0075_import-source-additions-notify: restore the rule that only
-- announces native and Zotero publications. Publications this migration made
-- eligible stay eligible; they were real additions to the library.
CREATE OR REPLACE FUNCTION record_notification_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_eligible boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "notificationItem" ("itemKey") VALUES (NEW."key") ON CONFLICT DO NOTHING;
  END IF;
  IF COALESCE(NEW."deleted", 0) <> 0 OR NEW."parentItem" IS NOT NULL
    OR NEW."itemType" IN ('Attachment', 'Note') THEN RETURN NEW;
  END IF;
  SELECT "provider" = 'native' OR (
    "provider" = 'zotero' AND "syncCursor" ? 'libraryVersion'
    AND (NOT ("syncCursor" ? 'pending') OR COALESCE(("syncCursor"->>'libraryVersion')::bigint, 0) > 0)
  ) INTO source_eligible FROM "sourceConnection" WHERE "key" = NEW."sourceConnectionKey";
  UPDATE "notificationItem" SET "firstPublishedAt" = clock_timestamp(), "eligible" = COALESCE(source_eligible, false)
    WHERE "itemKey" = NEW."key" AND "firstPublishedAt" IS NULL;
  RETURN NEW;
END;
$$;
