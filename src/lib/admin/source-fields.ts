import { and, asc, desc, eq, getTableColumns, inArray } from "drizzle-orm";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemSourceLink, sourceConnection } from "@/db/schema/source";
import { OPENALEX_WORK_PROVIDERS } from "@/lib/source-providers";
import { itemFieldOverride, itemSourceValue } from "@/db/schema/topics";
import { sourcePayloadHash } from "@/lib/source-ingestion/fingerprint";
import type { JsonValue } from "@/lib/source-ingestion/batch-schema";
import { createItemDraftPatch } from "./item-draft-merge";
import { LIBRARY_OWNED_PAYLOAD_FIELDS } from "./item-fields";
import { AdminValidationError } from "./errors";
import { sourceResolutionsSchema, type SourceFieldConflict } from "./source-field-contract";

type Reader = Pick<Database, "select">;
function sourceFieldFingerprint(value: unknown) {
  return sourcePayloadHash((value ?? null) as JsonValue);
}

/** Only sources of OpenAlex works keep source values; Zotero changes flow through writeback instead. */
async function sourceValues(db: Reader, itemKey: string) {
  return db.select(getTableColumns(itemSourceValue)).from(itemSourceValue)
    .innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceValue.sourceConnectionKey))
    .where(and(eq(itemSourceValue.itemKey, itemKey), inArray(sourceConnection.provider, OPENALEX_WORK_PROVIDERS))).orderBy(desc(itemSourceValue.remoteVersion), asc(itemSourceValue.sourceConnectionKey));
}

export async function readSourceFields(db: Reader, itemKey: string): Promise<SourceFieldConflict[]> {
  const [overrides, sources] = await Promise.all([
    db.select().from(itemFieldOverride).where(eq(itemFieldOverride.itemKey, itemKey)),
    sourceValues(db, itemKey),
  ]);
  return overrides.filter(override => override.field !== "deleted").flatMap(override => {
    // Overlapping queries share one work, so the newest copy is the source value.
    const source = sources.some(row => row.sourceConnectionKey === override.sourceConnectionKey) ? sources[0] : undefined;
    if (!source || !Object.hasOwn(source.payload, override.field)) return [];
    const sourceValue = source.payload[override.field] ?? null;
    const fingerprint = sourceFieldFingerprint(sourceValue);
    return [{field: override.field, value: override.value, sourceValue,
      sourceConnectionKey: source.sourceConnectionKey, sourceVersion: source.remoteVersion,
      fingerprint,
      conflicting: fingerprint !== sourceFieldFingerprint(override.sourceValue) && fingerprint !== sourceFieldFingerprint(override.value)}];
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

async function clearSourceOverride(db: DatabaseTransaction, itemKey: string, field: string) {
  await db.delete(itemFieldOverride).where(and(eq(itemFieldOverride.itemKey, itemKey), eq(itemFieldOverride.field, field)));
  const links = await db.select().from(itemSourceLink).where(eq(itemSourceLink.itemKey, itemKey));
  for (const link of links) await db.update(itemSourceLink).set({dirtyFields: link.dirtyFields.filter(value => value !== field)}).where(and(eq(itemSourceLink.itemKey, itemKey), eq(itemSourceLink.sourceConnectionKey, link.sourceConnectionKey)));
}

type FieldOverrideInput = {
  after: Record<string, unknown>;
  sources: Awaited<ReturnType<typeof sourceValues>>;
  resolution: ReturnType<typeof sourceResolutionsSchema.parse>[string] | undefined;
  prior: typeof itemFieldOverride.$inferSelect | undefined;
};

/** Use the chosen or previous source, else the newest one. */
function sourceFor({sources, resolution, prior}: FieldOverrideInput) {
  const sourceConnectionKey = resolution?.sourceConnectionKey ?? prior?.sourceConnectionKey;
  return sources.find(row => row.sourceConnectionKey === sourceConnectionKey) ?? sources[0]!;
}

async function publishFieldOverride(db: DatabaseTransaction, itemKey: string, field: string, input: FieldOverrideInput) {
  const {after, resolution, prior} = input;
  if (resolution?.choice === "source") return clearSourceOverride(db, itemKey, field);
  const source = sourceFor(input);
  if (field !== "deleted" && !Object.hasOwn(source.payload, field)) return;
  const values = {itemKey, field, value: after[field] ?? null,
    sourceValue: !resolution && prior ? prior.sourceValue : source.payload[field] ?? null,
    sourceConnectionKey: source.sourceConnectionKey, sourceVersion: source.remoteVersion, updatedAt: new Date()};
  await db.insert(itemFieldOverride).values(values).onConflictDoUpdate({target: [itemFieldOverride.itemKey, itemFieldOverride.field], set: values});
}

export async function publishSourceFieldOverrides(db: DatabaseTransaction, itemKey: string, before: Record<string, unknown>, after: Record<string, unknown>) {
  const sources = await sourceValues(db, itemKey);
  if (!sources.length) return;
  const previous = new Map((await db.select().from(itemFieldOverride).where(eq(itemFieldOverride.itemKey, itemKey))).map(row => [row.field, row]));
  const resolutions = sourceResolutionsSchema.parse(after.sourceResolutions ?? {});
  const patch = createItemDraftPatch(before, after);
  const fields = new Set([...Object.keys(patch), ...Object.keys(resolutions)]);
  for (const field of fields) {
    if (field !== "topics" && LIBRARY_OWNED_PAYLOAD_FIELDS.has(field)) continue;
    await publishFieldOverride(db, itemKey, field, {after, sources, resolution: resolutions[field], prior: previous.get(field)});
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
