import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemSourceLink, sourceConnection, sourceRecordAlias } from "@/db/schema/source";
import { OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";
import { sourceReference } from "@/db/schema/topics";
import { replaceSourceLinks } from "@/lib/links/item-links";
import type { SourceItemUpsert } from "../batch-schema";

/** The record each OpenAlex work is in here: the one imported from it, or the one kept when it was withdrawn as a repeat. */
export async function openAlexItemKeys(tx: Pick<Database, "select">, recordKeys: string[]) {
  const identities = new Map<string, string>();
  for (let offset = 0; offset < recordKeys.length; offset += 1000) {
    const found = await tx.select({record: itemSourceLink.sourceRecordKey, key: itemSourceLink.itemKey, withdrawn: itemSourceLink.remoteDeleted}).from(itemSourceLink)
      .innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
      .where(and(inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS), inArray(itemSourceLink.sourceRecordKey, recordKeys.slice(offset, offset + 1000))))
      // A live record before a withdrawn one, then the first by key: the same work always names the same record.
      .orderBy(asc(itemSourceLink.remoteDeleted), asc(itemSourceLink.itemKey));
    for (const target of found) if (!identities.has(target.record)) identities.set(target.record, target.key);
    // A work withdrawn as a repeat stands for the record kept instead, while that record is live and no source
    // still holds the work itself.
    const liveRecords = new Set(found.filter(target => !target.withdrawn).map(target => target.record));
    const repeats = await tx.select({record: sourceRecordAlias.aliasKey, key: sourceRecordAlias.itemKey}).from(sourceRecordAlias)
      .innerJoin(itemSourceLink, and(eq(itemSourceLink.itemKey, sourceRecordAlias.itemKey), eq(itemSourceLink.sourceConnectionKey, sourceRecordAlias.sourceConnectionKey)))
      .where(and(eq(sourceRecordAlias.kind, "duplicate-of"), eq(itemSourceLink.remoteDeleted, false), inArray(sourceRecordAlias.aliasKey, recordKeys.slice(offset, offset + 1000))))
      .orderBy(asc(sourceRecordAlias.itemKey));
    const repeated = new Set<string>();
    for (const target of repeats) {
      if (liveRecords.has(target.record) || repeated.has(target.record)) continue;
      repeated.add(target.record);
      identities.set(target.record, target.key);
    }
  }
  return identities;
}

async function resolveCites(tx: DatabaseTransaction, sourceConnectionKey: string, fromKeys: string[]) {
  const references = await tx.select().from(sourceReference).where(and(eq(sourceReference.sourceConnectionKey, sourceConnectionKey), inArray(sourceReference.itemKey, fromKeys)));
  const identities = await openAlexItemKeys(tx, [...new Set(references.map(row => row.targetRecordKey))]);
  const result = await replaceSourceLinks(tx, {sourceConnectionKey, kind: "cites", fromKeys,
    links: references.flatMap(reference => {
      const toKey = identities.get(reference.targetRecordKey);
      return toKey && toKey !== reference.itemKey ? [{fromKey: reference.itemKey, toKey}] : [];
    }),
  });
  return result.changedItemKeys;
}

/** A newly imported target resolves references saved by any overlapping query. */
export async function updateOpenAlexReferences(tx: DatabaseTransaction, sourceKey: string, records: SourceItemUpsert[], keys: Map<string, string>) {
  const roots = records.filter(record => !record.parentSourceRecordKey);
  const changedKeys = roots.map(record => keys.get(record.sourceRecordKey)!);
  if (changedKeys.length) await tx.delete(sourceReference).where(and(eq(sourceReference.sourceConnectionKey, sourceKey), inArray(sourceReference.itemKey, changedKeys)));
  const rows = roots.flatMap(record => [...new Set(record.referencedSourceRecordKeys)].map(targetRecordKey => ({sourceConnectionKey: sourceKey, itemKey: keys.get(record.sourceRecordKey)!, targetRecordKey})));
  for (let offset = 0; offset < rows.length; offset += 1000) await tx.insert(sourceReference).values(rows.slice(offset, offset + 1000)).onConflictDoNothing();
  if (!roots.length) return [];
  const affected = await tx.selectDistinct({sourceKey: sourceReference.sourceConnectionKey, itemKey: sourceReference.itemKey}).from(sourceReference)
    .where(or(inArray(sourceReference.targetRecordKey, roots.map(record => record.sourceRecordKey)), inArray(sourceReference.itemKey, changedKeys)));
  const groups = new Map<string, Set<string>>([[sourceKey, new Set(changedKeys)]]);
  for (const row of affected) groups.set(row.sourceKey, new Set([...(groups.get(row.sourceKey) ?? []), row.itemKey]));
  const changes = new Set<string>();
  for (const [sourceConnectionKey, fromKeys] of groups) {
    // Resolve bounded groups so a heavily cited work cannot make one huge SQL parameter list.
    const from = [...fromKeys];
    for (let offset = 0; offset < from.length; offset += 100) {
      for (const key of await resolveCites(tx, sourceConnectionKey, from.slice(offset, offset + 100))) changes.add(key);
    }
  }
  return [...changes];
}
