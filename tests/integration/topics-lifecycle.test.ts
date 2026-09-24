import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { itemDraft, itemSourceLink, sourceConnection, sourceRecordIssue } from "@/db/schema/source";
import { itemFieldOverride, itemSourceValue, topicCatalogCache, sourceTopicAssignment, topicAssociationDelivery } from "@/db/schema/topics";
import { createNativeItemDraft, openItemDraft, saveItemDraft, publishItemDraft, unpublishNativeItem } from "@/lib/admin/native-item-service";
import { readSourceFields } from "@/lib/admin/source-fields";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { runTopicAssociationCycle } from "@/lib/topics/association-delivery";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import type { Database } from "@/db/database-schema";

const settings = {approvedQuery: {version: "v1", approvedAt: "2026-09-24T10:00:00Z", query: {search: "schools"}}, downloadPdfs: false};
const config = libraryConfigSchema.parse({...maximalLibraryConfig, topics: {enabled: true}});
const policy = {writebackConfig: {...config, sources: [{key: "oa", writebackEnabled: false}]}};
async function seedTopics(db: Database) {
  await db.insert(topicCatalogCache).values(["T12260", "T12345"].map(id => ({id, kind: "node", payload: {id, name: `Topic ${id}`, level: "topic", parent: "subfields/3304", path: ["Social Sciences", "Social Sciences", "Education"], childCount: 0}, fetchedAt: new Date()})));
}
const work = (version: number, id = "W123", title = `Source ${version}`) => ({
  id, type: "article", title, updated_date: `2026-09-${String(10 + version).padStart(2, "0")}T10:00:00Z`,
  topics: [{id: "T12260", score: 0.8}, {id: "T12345", score: 0.1}], primary_topic: {id: "T12260"},
});
async function edit(db: Database, key: string, patch: Record<string, unknown>) {
  const draft = await openItemDraft(db, key, policy);
  return saveItemDraft(db, {itemKey: key, expectedDraftGeneration: draft.generation, expectedDraftRevision: draft.draftRevision,
    expectedPayload: draft.payload, payload: {...draft.payload, ...patch}}, policy);
}

it("keeps whole-field overrides through source updates, resolves both choices through publishing, and preserves manual no-DOI topics", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    await db.insert(sourceConnection).values({key: "oa", provider: "openalex", scopeKind: "query", config: settings});
    const ingest = async (version: number) => {
      const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa"));
      return writeSourceIngestionBatch(db, {sourceConnectionKey: "oa", expectedCursor: connection!.syncCursor,
        nextCursor: {version}, mappingProfileVersion: "openalex-v1", fetchedAt: new Date(), items: mapOpenAlexWork(work(version)).items});
    };
    const first = await ingest(1);
    const key = first.itemKeys.W123!;
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.topics).toEqual(["T12260"]);
    expect(await db.select().from(sourceTopicAssignment)).toHaveLength(2);
    await edit(db, key, {title: "Editor title", topics: ["T12345"]});
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.title).toBe("Source 1");
    await publishItemDraft(db, key, policy);
    await ingest(2);
    expect((await db.select().from(item).where(eq(item.key, key)))[0]).toMatchObject({title: "Editor title", topics: ["T12345"]});
    const conflict = (await readSourceFields(db, key)).find(field => field.field === "title")!;
    expect(conflict).toMatchObject({sourceValue: "Source 2", conflicting: true});
    await edit(db, key, {sourceResolutions: {title: {choice: "keep", sourceConnectionKey: "oa", fingerprint: conflict.fingerprint}}});
    await publishItemDraft(db, key, policy);
    expect((await readSourceFields(db, key)).find(field => field.field === "title")?.conflicting).toBe(false);
    await ingest(3);
    const newer = (await readSourceFields(db, key)).find(field => field.field === "title")!;
    await edit(db, key, {sourceResolutions: {title: {choice: "source", sourceConnectionKey: "oa", fingerprint: newer.fingerprint}}});
    await ingest(4);
    await expect(publishItemDraft(db, key, policy)).rejects.toThrow("source changed again");
    const latest = (await readSourceFields(db, key)).find(field => field.field === "title")!;
    await edit(db, key, {sourceResolutions: {title: {choice: "source", sourceConnectionKey: "oa", fingerprint: latest.fingerprint}}});
    await publishItemDraft(db, key, policy);
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.title).toBe("Source 4");
    expect((await db.select().from(itemFieldOverride)).map(row => row.field)).toEqual(["topics"]);
    await ingest(5);
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.title).toBe("Source 5");
    await unpublishNativeItem(db, key);
    await ingest(6);
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.deleted).toBe(1);
    await openItemDraft(db, key, policy);
    await publishItemDraft(db, key, policy);
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.deleted).toBe(0);
    const manual = await createNativeItemDraft(db, {itemType: "Report", title: "A manual record", topics: ["T12260"]}, policy);
    await publishItemDraft(db, manual.itemKey, policy);
    expect((await db.select().from(item).where(eq(item.key, manual.itemKey)))[0]).toMatchObject({DOI: null, topics: ["T12260"]});
    expect(await db.select().from(itemDraft).where(eq(itemDraft.itemKey, key))).toEqual([]);
  });
});

it("withdraws only after a successful complete query with no remaining membership, retaining editorial work", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    await db.insert(sourceConnection).values(["oa", "other"].map(key => ({key, provider: "openalex" as const, scopeKind: "query" as const, config: settings})));
    const run = async (key: string, results: ReturnType<typeof work>[], fail = false) => {
      await db.update(sourceConnection).set({syncCursor: {}}).where(eq(sourceConnection.key, key));
      const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, key));
      return syncOpenAlexSource({database: db, sourceConnection: connection!, heartbeat: async () => {}, credentialResolver: async () => "key"}, {
        sleep: async () => {}, fetch: async () => {if (fail) throw new Error("offline"); return Response.json({meta: {count: results.length, next_cursor: null}, results});},
      });
    };
    await run("oa", [work(1), work(1, "W456")]);
    await run("other", [work(1)]);
    const rows = await db.select().from(item);
    const key = rows.find(row => row.sourceRecordKey === "W123")!.key;
    const editedKey = rows.find(row => row.sourceRecordKey === "W456")!.key;
    await edit(db, editedKey, {title: "Keep this record"});
    await publishItemDraft(db, editedKey, policy);
    await expect(run("oa", [], true)).rejects.toThrow("offline");
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.deleted).toBe(0);
    await run("oa", []);
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.deleted).toBe(0);
    expect((await db.select().from(item).where(eq(item.key, editedKey)))[0]?.deleted).toBe(0);
    expect((await db.select().from(sourceRecordIssue))[0]?.code).toBe("source_membership_removed");
    await run("other", []);
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.deleted).toBe(1);
    expect((await db.select().from(itemSourceLink).where(eq(itemSourceLink.itemKey, key))).every(link => link.remoteDeleted)).toBe(true);
  });
});

it("delivers stable retry bodies and new generations for visibility changes without changing item revisions", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    const draft = await createNativeItemDraft(db, {itemType: "Report", title: "Manual topic", topics: ["T12260"]}, policy);
    const published = await publishItemDraft(db, draft.itemKey, policy);
    const config = libraryConfigSchema.parse({...maximalLibraryConfig, topics: {enabled: true}});
    const delivered: Record<string, unknown>[] = [];
    const request: typeof fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body)); delivered.push(body);
      return Response.json({contractVersion: 1, idempotencyKey: body.idempotencyKey, generation: body.generation, status: "applied"});
    };
    await runTopicAssociationCycle(db, config, undefined, async (url, init) => { await request(url, init); throw new Error("response lost after acceptance"); });
    const frozen = (await db.select().from(topicAssociationDelivery))[0]!.payload;
    await db.update(topicAssociationDelivery).set({nextAttemptAt: new Date(0)});
    await runTopicAssociationCycle(db, config, undefined, request);
    expect(delivered[1]).toEqual(frozen);
    delivered.shift();
    expect(delivered[0]).toMatchObject({state: "published", topicIds: ["T12260"], doi: null, openalexId: null, publishedRevision: published.revision});
    await runTopicAssociationCycle(db, {...config, topics: {enabled: false}, updatedAt: "2026-09-25T00:00:00Z"}, undefined, request);
    expect(delivered[1]).toMatchObject({state: "unpublished", topicIds: [], publishedRevision: published.revision});
    expect(Number(delivered[1]!.generation)).toBeGreaterThan(Number(delivered[0]!.generation));
    await runTopicAssociationCycle(db, {...config, updatedAt: "2026-09-26T00:00:00Z"}, undefined, request);
    expect(delivered[2]).toMatchObject({state: "published", topicIds: ["T12260"]});
    expect((await db.select().from(topicAssociationDelivery))[0]?.nextAttemptAt).toBeNull();
  });
});


it("rejects edits while disabled and unknown topics, retains private assignments, and never enriches pre-feature records", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    const off = {writebackConfig: {...config, topics: {enabled: false}}};
    await expect(createNativeItemDraft(db, {itemType: "Report", title: "Off", topics: ["T12260"]}, off)).rejects.toThrow("turned off");
    const unknownFetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(Response.json({contractVersion: 1, nodes: [], revision: "catalog-1", nextCursor: null, publicBaseUrl: "https://openscholar.example"}));
    try { await expect(createNativeItemDraft(db, {itemType: "Report", title: "Unknown", topics: ["T999999"]}, policy)).rejects.toThrow("Choose topics"); }
    finally { unknownFetch.mockRestore(); }
    const draft = await createNativeItemDraft(db, {itemType: "Report", title: "Manual", topics: ["T12260"]}, policy);
    await expect(publishItemDraft(db, draft.itemKey, off)).rejects.toThrow("turned off");
    await publishItemDraft(db, draft.itemKey, policy);
    const existing = await openItemDraft(db, draft.itemKey, off);
    await saveItemDraft(db, {itemKey: draft.itemKey, expectedDraftRevision: existing.draftRevision, expectedPayload: existing.payload, payload: {...existing.payload, title: "Other edit"}}, off);
    await publishItemDraft(db, draft.itemKey, off);
    expect((await db.select().from(item).where(eq(item.key, draft.itemKey)))[0]?.topics).toEqual(["T12260"]);
    await db.insert(sourceConnection).values({key: "oa", provider: "openalex", scopeKind: "query", config: settings});
    const first = await writeSourceIngestionBatch(db, {sourceConnectionKey: "oa", expectedCursor: {}, nextCursor: {v: 1}, mappingProfileVersion: "openalex-v1", fetchedAt: new Date(), items: mapOpenAlexWork(work(1)).items});
    const key = first.itemKeys.W123!;
    // A pre-feature row has no assignment eligibility or imported topic records.
    await db.delete(itemSourceValue).where(eq(itemSourceValue.itemKey, key));
    await db.delete(sourceTopicAssignment).where(eq(sourceTopicAssignment.itemKey, key));
    await db.update(item).set({topics: []}).where(eq(item.key, key));
    await writeSourceIngestionBatch(db, {sourceConnectionKey: "oa", expectedCursor: {v: 1}, nextCursor: {v: 2}, mappingProfileVersion: "openalex-v1", fetchedAt: new Date(), items: mapOpenAlexWork(work(2)).items});
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.topics).toEqual([]);
    expect(await db.select().from(sourceTopicAssignment).where(eq(sourceTopicAssignment.itemKey, key))).toEqual([]);
  });
});

it("shows the latest source conflict when an overlapping query supplies the update", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    await db.insert(sourceConnection).values(["oa", "other"].map(key => ({key, provider: "openalex" as const, scopeKind: "query" as const, config: settings})));
    const first = await writeSourceIngestionBatch(db, {sourceConnectionKey: "oa", expectedCursor: {}, nextCursor: {v: 1}, mappingProfileVersion: "openalex-v1", fetchedAt: new Date(), items: mapOpenAlexWork(work(1)).items});
    const key = first.itemKeys.W123!;
    await edit(db, key, {title: "Editorial title"});
    await publishItemDraft(db, key, policy);
    await writeSourceIngestionBatch(db, {sourceConnectionKey: "other", expectedCursor: {}, nextCursor: {v: 2}, mappingProfileVersion: "openalex-v1", fetchedAt: new Date(), items: mapOpenAlexWork(work(2)).items});
    const conflict = (await readSourceFields(db, key)).find(field => field.field === "title")!;
    expect(conflict).toMatchObject({sourceConnectionKey: "other", sourceValue: "Source 2", conflicting: true});
    await edit(db, key, {sourceResolutions: {title: {choice: "source", sourceConnectionKey: conflict.sourceConnectionKey, fingerprint: conflict.fingerprint}}});
    await publishItemDraft(db, key, policy);
    expect((await db.select().from(item).where(eq(item.key, key)))[0]?.title).toBe("Source 2");
  });
});
