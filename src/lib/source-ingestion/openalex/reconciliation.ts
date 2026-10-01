import { eq, sql } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { sourceConnection } from "@/db/schema/source";
import { SourceConnectionUnavailableError, SourceCursorConflictError } from "../transactional-writer";
import { sourcePayloadHash } from "../fingerprint";
import { jsonObjectSchema, type JsonValue } from "../batch-schema";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

type WithdrawalArgs = {
  sourceConnectionKey: string; configuration: Record<string, unknown>; cursor: Record<string, JsonValue>;
  /** The import run, so its withdrawals count in its search update. */
  sourceSyncRunId?: number;
};

/** Runs a withdrawal for a source whose configuration and cursor are still the ones the scan read. */
function withSourceUnchanged<T>(db: Database, args: WithdrawalArgs, withdraw: (tx: Transaction, provider: string) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`);
    const [connection] = await tx.select().from(sourceConnection).where(eq(sourceConnection.key, args.sourceConnectionKey)).for("update").limit(1);
    if (!connection || connection.status !== "active") throw new SourceConnectionUnavailableError(args.sourceConnectionKey);
    if (sourcePayloadHash(jsonObjectSchema.parse(connection.config)) !== sourcePayloadHash(jsonObjectSchema.parse(args.configuration)) || sourcePayloadHash(jsonObjectSchema.parse(connection.syncCursor)) !== sourcePayloadHash(args.cursor)) throw new SourceCursorConflictError(args.sourceConnectionKey);
    return withdraw(tx, connection.provider);
  });
}

/**
 * Takes the source's link off these items and withdraws the ones nothing else keeps. Edited items stay, with an
 * issue that says why the source let them go.
 */
async function withdrawItems(tx: Transaction, args: WithdrawalArgs, keys: string[], issueMessage: string) {
  const keyArray = sql`ARRAY[${sql.join(keys.map(key => sql`${key}`), sql`, `)}]::varchar[]`;
  await tx.execute(sql`UPDATE "itemSourceLink" SET "remoteDeleted" = true, "updatedAt" = now()
    WHERE "sourceConnectionKey" = ${args.sourceConnectionKey} AND "itemKey" = ANY(${keyArray})`);
  // Drafts, submitted reviews, persistent field overrides and library attachments or notes all count as editorial work.
  await tx.execute(sql`INSERT INTO "sourceRecordIssue" ("sourceConnectionKey", "sourceRecordKey", "code", "message", "createdAt", "updatedAt")
    SELECT ${args.sourceConnectionKey}, links."sourceRecordKey", 'source_membership_removed', ${issueMessage}, now(), now()
    FROM "item" i JOIN "itemSourceLink" links ON links."itemKey" = i.key AND links."sourceConnectionKey" = ${args.sourceConnectionKey}
    WHERE i.key = ANY(${keyArray}) AND i.deleted = 0
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
    WHERE i.key = ANY(${keyArray}) AND i.deleted = 0
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
}

/** Only a completely read query may withdraw its memberships. Each batch is retryable. */
export async function reconcileOpenAlexMemberships(db: Database, args: WithdrawalArgs & { startedAt: string }) {
  return withSourceUnchanged(db, args, async (tx, provider) => {
    const missing = await tx.execute<{itemKey: string}>(sql`
      SELECT links."itemKey" FROM "itemSourceLink" links JOIN "sourceSnapshot" snapshot
        ON snapshot."itemKey" = links."itemKey" AND snapshot."sourceConnectionKey" = links."sourceConnectionKey"
      WHERE links."sourceConnectionKey" = ${args.sourceConnectionKey} AND NOT links."remoteDeleted"
        AND snapshot."fetchedAt" < ${new Date(args.startedAt)} ORDER BY links."itemKey" LIMIT 100
    `);
    const keys = missing.rows.map(row => row.itemKey);
    if (!keys.length) return 0;
    await withdrawItems(tx, args, keys, provider === "openscholar"
      ? "This edited record is no longer in the connected OpenScholar collection."
      : "This edited record no longer matches any connected OpenAlex search.");
    return keys.length;
  });
}

/** A record of the source that repeats another one, kept instead. */
export type DuplicateRecord = { recordKey: string; itemKey: string; keptItemKey: string };

/**
 * Withdraws records that repeat another record of the source, with their attachments, and remembers which record
 * each repeats so later scans skip it. A full scan also forgets duplicates whose kept record it did not read, so
 * the repeat comes back if the record it repeated left the query.
 */
export async function withdrawDuplicateRecords(db: Database, args: WithdrawalArgs & { duplicates: DuplicateRecord[]; readSince: string | null }) {
  return withSourceUnchanged(db, args, async tx => {
    if (args.readSince) {
      await tx.execute(sql`DELETE FROM "sourceRecordAlias" alias
        WHERE alias."sourceConnectionKey" = ${args.sourceConnectionKey} AND alias.kind = 'duplicate-of'
          AND NOT EXISTS (SELECT 1 FROM "sourceSnapshot" kept
            WHERE kept."itemKey" = alias."itemKey" AND kept."sourceConnectionKey" = alias."sourceConnectionKey" AND kept."fetchedAt" >= ${new Date(args.readSince)})`);
    }
    if (!args.duplicates.length) return 0;
    await tx.execute(sql`INSERT INTO "sourceRecordAlias" ("sourceConnectionKey", "aliasKey", "itemKey", kind)
      VALUES ${sql.join(args.duplicates.map(duplicate => sql`(${args.sourceConnectionKey}, ${duplicate.recordKey}, ${duplicate.keptItemKey}, 'duplicate-of')`), sql`, `)}
      ON CONFLICT ("sourceConnectionKey", "aliasKey") DO UPDATE SET "itemKey" = EXCLUDED."itemKey", kind = EXCLUDED.kind`);
    const parents = args.duplicates.map(duplicate => duplicate.itemKey);
    const children = await tx.execute<{key: string}>(sql`
      SELECT child.key FROM "item" child JOIN "itemSourceLink" links ON links."itemKey" = child.key AND links."sourceConnectionKey" = ${args.sourceConnectionKey}
      WHERE child."parentItem" = ANY(ARRAY[${sql.join(parents.map(key => sql`${key}`), sql`, `)}]::varchar[])`);
    await withdrawItems(tx, args, [...parents, ...children.rows.map(row => row.key)],
      "This edited record repeats another record of the same upload, which is kept instead.");
    return args.duplicates.length;
  });
}
