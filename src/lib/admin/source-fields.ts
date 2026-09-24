import { and, asc, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemSourceLink, sourceConnection } from "@/db/schema/source";
import { itemFieldOverride, itemSourceValue } from "@/db/schema/topics";
import { sourcePayloadHash } from "@/lib/source-ingestion/fingerprint";
import type { JsonValue } from "@/lib/source-ingestion/batch-schema";
import { createItemDraftPatch } from "./item-draft-merge";
import { LIBRARY_OWNED_PAYLOAD_FIELDS } from "./item-fields";
import { AdminValidationError } from "./errors";
import { sourceResolutionsSchema, type SourceFieldConflict } from "./source-field-contract";

type Reader = Pick<Database, "select">;
export function sourceFieldFingerprint(value: unknown) {
  return sourcePayloadHash((value ?? null) as JsonValue);
}

async function sourceValues(db: Reader, itemKey: string) {
  return db.select({...getTableColumns(itemSourceValue), provider: sourceConnection.provider}).from(itemSourceValue)
    .innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceValue.sourceConnectionKey))
    .where(eq(itemSourceValue.itemKey, itemKey)).orderBy(desc(itemSourceValue.remoteVersion), asc(itemSourceValue.sourceConnectionKey));
}

export async function readSourceFields(db: Reader, itemKey: string): Promise<SourceFieldConflict[]> {
  const [overrides, sources] = await Promise.all([
    db.select().from(itemFieldOverride).where(eq(itemFieldOverride.itemKey, itemKey)),
    sourceValues(db, itemKey),
  ]);
  return overrides.filter(override => override.field !== "deleted").flatMap(override => {
    const original = sources.find(row => row.sourceConnectionKey === override.sourceConnectionKey);
    const source = original?.provider === "openalex" ? sources.find(row => row.provider === "openalex") : original;
    if (!source || !Object.hasOwn(source.payload, override.field)) return [];
    const sourceValue = source.payload[override.field] ?? null;
    return [{field: override.field, value: override.value, sourceValue,
      sourceConnectionKey: source?.sourceConnectionKey ?? override.sourceConnectionKey, sourceVersion: source?.remoteVersion ?? null,
      fingerprint: sourceFieldFingerprint(sourceValue),
      conflicting: sourceFieldFingerprint(sourceValue) !== sourceFieldFingerprint(override.sourceValue) && sourceFieldFingerprint(sourceValue) !== sourceFieldFingerprint(override.value)}];
  });
}

/** Resolve against the source in the publishing transaction, including review publication. */
export async function resolveSourceFieldChoices(db: Reader, itemKey: string, payload: Record<string, unknown>) {
  const choices = sourceResolutionsSchema.parse(payload.sourceResolutions ?? {});
  if (!Object.keys(choices).length) return payload;
  const fields = new Map((await readSourceFields(db, itemKey)).map(field => [field.field, field]));
  const resolved = {...payload};
  for (const [field, choice] of Object.entries(choices)) {
    const current = fields.get(field);
    if (!current || current.sourceConnectionKey !== choice.sourceConnectionKey || current.fingerprint !== choice.fingerprint) {
      throw new AdminValidationError("The source changed again. Review its latest value before publishing.", {[field]: "Review the latest source value."});
    }
    if (choice.choice === "source") {
      if (current.sourceValue === null) delete resolved[field];
      else resolved[field] = current.sourceValue;
    }
  }
  return resolved;
}

export async function publishSourceFieldOverrides(db: DatabaseTransaction, itemKey: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  let sources = await sourceValues(db, itemKey);
  if (!sources.length) {
    const links = await db.select().from(itemSourceLink).where(eq(itemSourceLink.itemKey, itemKey));
    const sourcePayload = {...before};
    delete sourcePayload.topics;
    for (const link of links) await db.insert(itemSourceValue).values({itemKey, sourceConnectionKey: link.sourceConnectionKey, payload: sourcePayload, remoteVersion: link.remoteVersion, importedTopics: false}).onConflictDoNothing();
    sources = await sourceValues(db, itemKey);
    if (!sources.length) return;
  }
  const previous = new Map((await db.select().from(itemFieldOverride).where(eq(itemFieldOverride.itemKey, itemKey))).map(row => [row.field, row]));
  const resolutions = sourceResolutionsSchema.parse(after.sourceResolutions ?? {});
  const patch = createItemDraftPatch(before, after);
  const fields = new Set([...Object.keys(patch), ...Object.keys(resolutions)]);
  for (const field of fields) {
    if (field !== "topics" && LIBRARY_OWNED_PAYLOAD_FIELDS.has(field)) continue;
    const resolution = resolutions[field];
    if (resolution?.choice === "source") {
      await db.delete(itemFieldOverride).where(and(eq(itemFieldOverride.itemKey, itemKey), eq(itemFieldOverride.field, field)));
      const links = await db.select().from(itemSourceLink).where(eq(itemSourceLink.itemKey, itemKey));
      for (const link of links) await db.update(itemSourceLink).set({dirtyFields: link.dirtyFields.filter(value => value !== field)}).where(and(eq(itemSourceLink.itemKey, itemKey), eq(itemSourceLink.sourceConnectionKey, link.sourceConnectionKey)));
      continue;
    }
    const prior = previous.get(field);
    const source = sources.find(row => row.sourceConnectionKey === (resolution?.sourceConnectionKey ?? prior?.sourceConnectionKey)) ?? sources[0]!;
    if (field !== "deleted" && !Object.hasOwn(source.payload, field)) continue;
    const values = {itemKey, field, value: after[field] ?? null,
      sourceValue: resolution ? source.payload[field] ?? null : prior ? prior.sourceValue : source.payload[field] ?? null,
      sourceConnectionKey: source.sourceConnectionKey, sourceVersion: source.remoteVersion, updatedAt: new Date()};
    await db.insert(itemFieldOverride).values(values).onConflictDoUpdate({target: [itemFieldOverride.itemKey, itemFieldOverride.field], set: values});
  }
}

export async function sourceOverridesByItem(db: Reader, keys: string[]) {
  const result = new Map<string, Record<string, unknown>>();
  if (!keys.length) return result;
  for (const row of await db.select().from(itemFieldOverride).where(inArray(itemFieldOverride.itemKey, keys))) {
    result.set(row.itemKey, {...result.get(row.itemKey), [row.field]: row.value});
  }
  return result;
}
