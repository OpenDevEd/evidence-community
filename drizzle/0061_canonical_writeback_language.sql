-- Dirty fields use canonical database names, including queued writes.
UPDATE "itemSourceLink"
SET "dirtyFields" = ("dirtyFields" - 'language' - 'languageName') || '["languageName"]'::jsonb
WHERE "dirtyFields" ? 'language';
--> statement-breakpoint
UPDATE "sourceWritebackJob"
SET "dirtyFields" = ("dirtyFields" - 'language' - 'languageName') || '["languageName"]'::jsonb
WHERE "dirtyFields" ? 'language';
