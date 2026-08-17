ALTER TABLE "itemFilePublication" ADD COLUMN "md5" varchar(32);--> statement-breakpoint
UPDATE "itemFilePublication" AS publication
SET "md5" = lower(item."md5")
FROM "item" AS item
WHERE item."key" = publication."itemKey"
	AND item."md5" ~* '^[0-9a-f]{32}$';--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (
		SELECT 1
		FROM "itemFilePublication"
		WHERE "md5" IS NULL OR "md5" !~ '^[0-9a-f]{32}$'
	) THEN
		RAISE EXCEPTION 'A published PDF is missing a valid MD5. Remove that development file publication and publish the PDF again.';
	END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "itemFilePublication" ALTER COLUMN "md5" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "itemFilePublication" ADD CONSTRAINT "itemFilePublication_md5_valid" CHECK ("itemFilePublication"."md5" ~ '^[0-9a-f]{32}$');
