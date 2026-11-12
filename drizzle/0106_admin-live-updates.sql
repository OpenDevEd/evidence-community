-- The admin shows what other people and the workers change without a reload. A statement that changes rows in a table
-- the admin shows says so on the "admin_changed" channel, with the table's name. The web server listens while an admin
-- page is open and tells the page which part to read again (src/lib/admin/live.ts; the tables and their parts are in
-- src/lib/admin/live-contract.ts). Postgres delivers on commit and sends a transaction's repeats once, so an import
-- that writes a table a thousand times in one transaction sends one notice. A statement that changed no rows, such as a
-- worker finding nothing to claim, sends nothing: that is what the transition tables are for.
CREATE OR REPLACE FUNCTION notify_admin_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM changed_rows) THEN
    PERFORM pg_notify('admin_changed', TG_TABLE_NAME);
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
DO $$
DECLARE watched text;
BEGIN
  FOREACH watched IN ARRAY ARRAY[
    'item', 'itemIdentity', 'itemDraft', 'itemFileDraft', 'itemFilePublication', 'itemFileRemoval', 'itemFieldOverride',
    'itemSourceFileChoice', 'itemSourceLink', 'itemSourceValue', 'itemLink', 'itemInstitution', 'itemToTag',
    'itemToCollection', 'itemReview', 'itemReviewFile', 'itemPublishingChoice', 'itemImportCheck', 'addedPaper',
    'adminItemListProjection', 'sourceTopicAssignment', 'tag', 'collection', 'collectionIdentity',
    'collectionSourceLink', 'sourceConnection', 'sourceSyncState', 'sourceSyncRun', 'sourceRecordIssue',
    'publicationIdentifier', 'publicationSyncJob', 'publicationTarget', 'zenodoFileCorrectionApproval',
    'notificationEdition', 'notificationEditionEvent', 'notificationDelivery', 'notificationSubscriber', 'pdfImport',
    'pdfImportFile'
  ] LOOP
    EXECUTE format('CREATE TRIGGER admin_changed_insert AFTER INSERT ON %I REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_changed()', watched);
    EXECUTE format('CREATE TRIGGER admin_changed_update AFTER UPDATE ON %I REFERENCING NEW TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_changed()', watched);
    EXECUTE format('CREATE TRIGGER admin_changed_delete AFTER DELETE ON %I REFERENCING OLD TABLE AS changed_rows FOR EACH STATEMENT EXECUTE FUNCTION notify_admin_changed()', watched);
  END LOOP;
END;
$$;
