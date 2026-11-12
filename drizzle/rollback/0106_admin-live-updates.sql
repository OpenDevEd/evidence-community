-- Rollback for 0106_admin-live-updates. An older runtime listens for nothing, so the triggers and their function go.
-- No stored data changes either way.
DO $$
DECLARE watched record;
BEGIN
  FOR watched IN
    SELECT tgrelid::regclass AS relation, tgname FROM pg_trigger
    WHERE tgname IN ('admin_changed_insert', 'admin_changed_update', 'admin_changed_delete') AND NOT tgisinternal
  LOOP
    EXECUTE format('DROP TRIGGER %I ON %s', watched.tgname, watched.relation);
  END LOOP;
END;
$$;
--> statement-breakpoint
DROP FUNCTION IF EXISTS notify_admin_changed();
