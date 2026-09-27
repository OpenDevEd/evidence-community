import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { sourceConnection } from "@/db/schema/source";
import { SourceConnectionUnavailableError, SourceCursorConflictError } from "../transactional-writer";
import { sourcePayloadHash } from "../fingerprint";
import { jsonObjectSchema, type JsonValue } from "../batch-schema";

/** Only a completely read query may withdraw its memberships. Each batch is retryable. */
export async function reconcileOpenAlexMemberships(db: Database, args: {
  sourceConnectionKey: string; configuration: Record<string, unknown>; cursor: Record<string, JsonValue>; startedAt: string;
  /** The import run, so its withdrawals count in its search update. */
  sourceSyncRunId?: number;
}) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`);
    const [connection] = await tx.select().from(sourceConnection).where(eq(sourceConnection.key, args.sourceConnectionKey)).for("update").limit(1);
    if (!connection || connection.status !== "active") throw new SourceConnectionUnavailableError(args.sourceConnectionKey);
    if (sourcePayloadHash(jsonObjectSchema.parse(connection.config)) !== sourcePayloadHash(jsonObjectSchema.parse(args.configuration)) || sourcePayloadHash(jsonObjectSchema.parse(connection.syncCursor)) !== sourcePayloadHash(args.cursor)) throw new SourceCursorConflictError(args.sourceConnectionKey);
    const missing = await tx.execute<{itemKey: string}>(sql`
      SELECT links."itemKey" FROM "itemSourceLink" links JOIN "sourceSnapshot" snapshot
        ON snapshot."itemKey" = links."itemKey" AND snapshot."sourceConnectionKey" = links."sourceConnectionKey"
      WHERE links."sourceConnectionKey" = ${args.sourceConnectionKey} AND NOT links."remoteDeleted"
        AND snapshot."fetchedAt" < ${new Date(args.startedAt)} ORDER BY links."itemKey" LIMIT 100
    `);
    const keys = missing.rows.map(row => row.itemKey);
    if (!keys.length) return 0;
    await tx.execute(sql`UPDATE "itemSourceLink" SET "remoteDeleted" = true, "updatedAt" = now()
      WHERE "sourceConnectionKey" = ${args.sourceConnectionKey} AND "itemKey" = ANY(ARRAY[${sql.join(keys.map(key => sql`${key}`), sql`, `)}]::varchar[])`);
    // Drafts, submitted reviews, persistent field overrides and library attachments or notes all count as editorial work.
    await tx.execute(sql`INSERT INTO "sourceRecordIssue" ("sourceConnectionKey", "sourceRecordKey", "code", "message", "createdAt", "updatedAt")
      SELECT ${args.sourceConnectionKey}, links."sourceRecordKey", 'source_membership_removed',
        'This edited record no longer matches any connected OpenAlex search.', now(), now()
      FROM "item" i JOIN "itemSourceLink" links ON links."itemKey" = i.key AND links."sourceConnectionKey" = ${args.sourceConnectionKey}
      WHERE i.key = ANY(ARRAY[${sql.join(keys.map(key => sql`${key}`), sql`, `)}]::varchar[]) AND i.deleted = 0
        AND NOT EXISTS (SELECT 1 FROM "itemSourceLink" other JOIN "sourceConnection" c ON c.key = other."sourceConnectionKey"
          WHERE other."itemKey" = i.key AND NOT other."remoteDeleted" AND c.status <> 'removed')
        AND (EXISTS (SELECT 1 FROM "itemFieldOverride" o WHERE o."itemKey" = i.key)
          OR EXISTS (SELECT 1 FROM "itemDraft" d WHERE d."itemKey" = i.key OR d."itemKey" IN (SELECT child.key FROM "item" child WHERE child."parentItem" = i.key) OR d.patch ->> 'parentItem' = i.key)
          OR EXISTS (SELECT 1 FROM "itemFieldOverride" o JOIN "item" child ON child.key = o."itemKey" WHERE child."parentItem" = i.key)
          OR EXISTS (SELECT 1 FROM "item" child WHERE child."parentItem" = i.key AND child."sourceConnectionKey" = 'native' AND child.deleted = 0)
          OR EXISTS (SELECT 1 FROM "itemReview" r WHERE r."itemKey" = COALESCE(i."parentItem", i.key) AND r.state = 'pending')
          OR EXISTS (SELECT 1 FROM "itemSourceLink" dirty WHERE dirty."itemKey" = i.key AND dirty."dirtyFields" <> '[]'::jsonb))
      ON CONFLICT ("sourceConnectionKey", "sourceRecordKey") DO UPDATE SET "code" = EXCLUDED."code", "message" = EXCLUDED."message", "updatedAt" = now(), "dismissedAt" = NULL
    `);
    await tx.execute(sql`WITH withdrawn AS (
      UPDATE "item" i SET deleted = 1, "deletedAt" = now(), revision = revision + 1, "updatedAt" = now()
      WHERE i.key = ANY(ARRAY[${sql.join(keys.map(key => sql`${key}`), sql`, `)}]::varchar[]) AND i.deleted = 0
        AND NOT EXISTS (SELECT 1 FROM "itemSourceLink" other JOIN "sourceConnection" c ON c.key = other."sourceConnectionKey"
          WHERE other."itemKey" = i.key AND NOT other."remoteDeleted" AND c.status <> 'removed')
        AND NOT EXISTS (SELECT 1 FROM "itemFieldOverride" o WHERE o."itemKey" = i.key)
        AND NOT EXISTS (SELECT 1 FROM "itemDraft" d WHERE d."itemKey" = i.key OR d."itemKey" IN (SELECT child.key FROM "item" child WHERE child."parentItem" = i.key) OR d.patch ->> 'parentItem' = i.key)
        AND NOT EXISTS (SELECT 1 FROM "itemFieldOverride" o JOIN "item" child ON child.key = o."itemKey" WHERE child."parentItem" = i.key)
        AND NOT EXISTS (SELECT 1 FROM "item" child WHERE child."parentItem" = i.key AND child."sourceConnectionKey" = 'native' AND child.deleted = 0)
        AND NOT EXISTS (SELECT 1 FROM "itemReview" r WHERE r."itemKey" = COALESCE(i."parentItem", i.key) AND r.state = 'pending')
        AND NOT EXISTS (SELECT 1 FROM "itemSourceLink" dirty WHERE dirty."itemKey" = i.key AND dirty."dirtyFields" <> '[]'::jsonb)
      RETURNING key, revision
    ) INSERT INTO outbox ("entityType", "entityKey", operation, revision, "sourceSyncRunId") SELECT 'item', key, 'delete', revision, ${args.sourceSyncRunId ?? null}::bigint FROM withdrawn`);
    return keys.length;
  });
}
