import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { eq, sql } from "drizzle-orm";
import { outbox } from "@opendeved/evidence-library-core";
import { item } from "@/db/schema/tables/item";
import { status } from "@/db/schema/tables/status";
import { itemDraft, itemSourceLink, sourceConnection, sourceRecordIssue } from "@/db/schema/source";
import { itemFieldOverride, itemSourceValue, topicCatalogCache, sourceTopicAssignment, topicAssociationDelivery, topicDeliveryConfiguration } from "@/db/schema/topics";
import { createNativeItemDraft, openItemDraft, saveItemDraft, publishItemDraft, unpublishNativeItem } from "@/lib/admin/native-item-service";
import { readPublicItem } from "@/lib/search-index/projection";
import { prepareSearchProjection, setSearchIndexRebuildPending } from "@/lib/search-index/bootstrap-state";
import { readPublicTopicCatalog, resolveTopicNodes } from "@/lib/topics/catalog";
import { readSourceFields } from "@/lib/admin/source-fields";
import { writeSourceIngestionBatch } from "@/lib/source-ingestion/transactional-writer";
import { mapOpenAlexWork } from "@/lib/source-ingestion/openalex/mapper";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { runTopicAssociationCycle } from "@/lib/topics/association-delivery";
import { SourceWritebackAdapterRegistry } from "@/lib/source-writeback/adapter";
import { processNextSourceWritebackJob } from "@/lib/source-writeback/consumer";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import type { Database } from "@/db/database-schema";

const settings = {name: "Schools", searchUrl: "/results/saved-search-1", approvedQuery: {version: "v1", approvedAt: "2026-09-24T10:00:00Z", query: {search: "schools"}}, downloadPdfs: false};
const config = libraryConfigSchema.parse({...maximalLibraryConfig, topics: {enabled: true}});
const policy = {writebackConfig: {...config, sources: [{key: "oa", writebackEnabled: false}]}};
/** Openscholar's batch route as these tests see it: it notes each record and saves it. */
const receiving = (delivered: unknown[]): typeof fetch => async (_url, init) => {
  const {deliveries} = JSON.parse(String(init?.body)) as {deliveries: {idempotencyKey: string; generation: number}[]};
  delivered.push(...deliveries);
  return Response.json({contractVersion: 1, receipts: deliveries.map(({idempotencyKey, generation}) => ({contractVersion: 1, idempotencyKey, generation, status: "applied"}))});
};
async function seedTopics(db: Database) {
  await db.insert(topicCatalogCache).values(["T12260", "T12345"].map(id => ({id, kind: "node", payload: {id, name: `Topic ${id}`, level: "topic", parent: "subfields/3304", path: ["Social Sciences", "Social Sciences", "Education"], childCount: 0}, fetchedAt: new Date()})));
}
const work = (version: number, id = "W123", title = `Source ${version}`) => ({
  id, type: "article", title, updated_date: `2026-09-${String(10 + version).padStart(2, "0")}T10:00:00Z`,
  topics: [{id: "T12260", score: 0.8}, {id: "T12345", score: 0.1}], primary_topic: {id: "T12260"},
});
async function edit(db: Database, key: string, patch: Record<string, unknown>, editPolicy = policy) {
  const draft = await openItemDraft(db, key, editPolicy);
  return saveItemDraft(db, {itemKey: key, expectedDraftGeneration: draft.generation, expectedDraftRevision: draft.draftRevision,
    expectedPayload: draft.payload, payload: {...draft.payload, ...patch}}, editPolicy);
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
    const request = receiving(delivered);
    await runTopicAssociationCycle(db, config, undefined, async (url, init) => { await request(url, init); throw new Error("response lost after acceptance"); });
    const frozen = (await db.select().from(topicAssociationDelivery))[0]!.payload;
    await db.update(topicAssociationDelivery).set({nextAttemptAt: new Date(0)});
    await runTopicAssociationCycle(db, config, undefined, request);
    expect(delivered[1]).toEqual(frozen);
    delivered.shift();
    expect(delivered[0]).toMatchObject({state: "published", topicIds: ["T12260"], doi: null, openalexId: null, publishedRevision: published.revision});
    await runTopicAssociationCycle(db, {...config, topics: {enabled: false}, updatedAt: "2026-09-25T00:00:00Z"}, undefined, request);
    expect(delivered[1]).toMatchObject({state: "published", topicIds: [], publishedRevision: published.revision});
    expect(Number(delivered[1]!.generation)).toBeGreaterThan(Number(delivered[0]!.generation));
    await runTopicAssociationCycle(db, {...config, updatedAt: "2026-09-26T00:00:00Z"}, undefined, request);
    expect(delivered[2]).toMatchObject({state: "published", topicIds: ["T12260"]});
    expect((await db.select().from(topicAssociationDelivery))[0]?.nextAttemptAt).toBeNull();
  });
});


it("sends a record's PDF and its cover with it, and sends the record again when its attachment changes", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    const draft = await createNativeItemDraft(db, {itemType: "Report", title: "Coaching", topics: ["T12260"]}, policy);
    const published = await publishItemDraft(db, draft.itemKey, policy);
    const delivered: {metadata?: {pdf?: unknown}}[] = [];
    const request = receiving(delivered);
    await runTopicAssociationCycle(db, config, undefined, request);
    expect(delivered.at(-1)?.metadata?.pdf).toBeNull();
    // A stored PDF arrives, written as an attachment and its outbox entry. Without its cover it isn't public yet.
    await db.execute(sql`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ('PDFCVRAB', 'native', 'PDFCVRAB')`);
    await db.execute(sql`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "revision", "title", "parentItem", "linkMode", "contentType", "dateAdded", "deleted")
      VALUES ('PDFCVRAB', 'native', 'PDFCVRAB', 'Attachment', 1, 'Full text', ${draft.itemKey}, 'imported_file', 'application/pdf', now(), 0)`);
    await db.insert(outbox).values({entityType: "item", entityKey: "PDFCVRAB", operation: "upsert", revision: 1});
    await runTopicAssociationCycle(db, config, undefined, request);
    expect(delivered.at(-1)?.metadata?.pdf).toBeNull();
    // Its cover drawn, the record goes again with both.
    await db.execute(sql`UPDATE "item" SET "PDFCoverPageImage" = 'https://files.example.test/covers/PDFCVRAB.png', "PDFCoverPageWidth" = 600, "PDFCoverPageHeight" = 800, "revision" = 2 WHERE key = 'PDFCVRAB'`);
    await db.insert(outbox).values({entityType: "item", entityKey: "PDFCVRAB", operation: "upsert", revision: 2});
    await runTopicAssociationCycle(db, config, undefined, request);
    expect(delivered.at(-1)).toMatchObject({publishedRevision: published.revision, metadata: {pdf: {
      url: new URL(`/lib/${draft.itemKey}/download/PDFCVRAB`, `${config.identity.baseUrl}/`).href,
      cover: "https://files.example.test/covers/PDFCVRAB.png",
    }}});
  });
});

it("sends every published record on the first run while Topics are off, without topics", async () => {
  await withIsolatedPublicationDatabase(async db => {
    const draft = await createNativeItemDraft(db, {itemType: "Report", title: "Never topical"});
    await publishItemDraft(db, draft.itemKey);
    await db.delete(topicAssociationDelivery);
    const delivered: Record<string, unknown>[] = [];
    const request = receiving(delivered);
    await runTopicAssociationCycle(db, {...config, topics: {enabled: false}}, undefined, request);
    expect(delivered).toEqual([expect.objectContaining({itemKey: draft.itemKey, state: "published", topicIds: [], metadata: expect.objectContaining({title: "Never topical"})})]);
    expect(await db.select().from(topicDeliveryConfiguration)).toHaveLength(1);
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
    await publishItemDraft(db, draft.itemKey, off);
    const existing = await openItemDraft(db, draft.itemKey, off);
    await saveItemDraft(db, {itemKey: draft.itemKey, expectedDraftRevision: existing.draftRevision, expectedPayload: existing.payload, payload: {...existing.payload, title: "Other edit"}}, off);
    await publishItemDraft(db, draft.itemKey, off);
    expect((await db.select().from(item).where(eq(item.key, draft.itemKey)))[0]?.topics).toEqual(["T12260"]);
    expect((await readPublicItem(db, draft.itemKey, off.writebackConfig))?.topics).toEqual([]);
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


it("rebuilds existing search documents when topic visibility changes and retains the request across failures", async () => {
  await withIsolatedPublicationDatabase(async db => {
    expect(await prepareSearchProjection(db, "meilisearch", false, true, [])).toBe(true);
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "meilisearch", false, true, [])).toBe(false);
    expect(await prepareSearchProjection(db, "meilisearch", true, true, [])).toBe(true);
    expect(await prepareSearchProjection(db, "meilisearch", true, true, [])).toBe(true);
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "meilisearch", true, true, [])).toBe(false);
    expect(await prepareSearchProjection(db, "meilisearch", false, true, [])).toBe(true);
    // Switching full-text search adds or removes page text, so it rebuilds too.
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "meilisearch", false, false, [])).toBe(true);
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "meilisearch", false, false, [])).toBe(false);
    // Hidden tags decide which records have a PDF, so changing them rebuilds too.
    expect(await prepareSearchProjection(db, "meilisearch", false, false, ["hidden"])).toBe(true);
    // An index an older runtime built keeps its old documents unless it rebuilds.
    await db.update(status).set({searchProjectionSignature: JSON.stringify({topics: false, fullText: false})}).where(eq(status.id, 1));
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "meilisearch", false, false, ["hidden"])).toBe(true);
    // A Meilisearch library keeps the signature it stored before engines were configurable, so upgrading doesn't
    // rebuild it; Elasticsearch adds its index definition.
    await db.update(status).set({searchProjectionSignature: JSON.stringify({version: 13, topics: false, fullText: false, hiddenTags: ["hidden"]})}).where(eq(status.id, 1));
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "meilisearch", false, false, ["hidden"])).toBe(false);
    expect(await prepareSearchProjection(db, "elasticsearch", false, false, ["hidden"])).toBe(true);
    // In Elasticsearch the worker makes the vectors, so another embedder, or none, rebuilds; Meilisearch embeds itself.
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "elasticsearch", false, false, ["hidden"], "model-a")).toBe(true);
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "elasticsearch", false, false, ["hidden"], "model-a")).toBe(false);
    expect(await prepareSearchProjection(db, "elasticsearch", false, false, ["hidden"], "model-b")).toBe(true);
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "elasticsearch", false, false, ["hidden"], null)).toBe(true);
    await db.update(status).set({searchProjectionSignature: JSON.stringify({version: 13, topics: false, fullText: false, hiddenTags: ["hidden"]})}).where(eq(status.id, 1));
    await setSearchIndexRebuildPending(db, false);
    expect(await prepareSearchProjection(db, "meilisearch", false, false, ["hidden"], "model-a")).toBe(false);
  });
});

it("ignores invalid or removed topic URL IDs without relaxing topic assignment validation", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    const request: typeof fetch = async () => Response.json({contractVersion: 1, nodes: [], revision: "test", nextCursor: null, publicBaseUrl: "https://openscholar.example"});
    const context = {database: db, config, fetch: request};
    expect((await resolveTopicNodes(["invalid", "T999999", "T12260"], context, {allowUnknown: true})).map(node => node.id)).toEqual(["T12260"]);
    await expect(resolveTopicNodes(["T999999"], context)).rejects.toMatchObject({status: 404});
  });
});

it("answers catalog ID lookups from the stored catalog without calling OpenScholar", async () => {
  await withIsolatedPublicationDatabase(async db => {
    const nodes = ["T12260", "T12345"].map(id => ({id, name: `Topic ${id}`, level: "topic" as const, parent: "subfields/3304", path: ["Social Sciences"], childCount: 0}));
    let calls = 0;
    const context = {database: db, config, fetch: (async () => { calls += 1; return Response.json({contractVersion: 1, nodes, revision: "r1", nextCursor: null, publicBaseUrl: "https://openscholar.example"}); }) as typeof fetch};
    const request = {contractVersion: 1 as const, libraryId: config.authentication.openScholar.libraryId, cursor: null, limit: 100};
    await readPublicTopicCatalog({...request, parent: "subfields/3304"}, context);
    expect(await readPublicTopicCatalog({...request, ids: ["T12345"]}, context)).toEqual({contractVersion: 1, nodes: [nodes[1]], revision: "r1", nextCursor: null, publicBaseUrl: "https://openscholar.example"});
    expect(calls).toBe(1);
  });
});

it("applies a Zotero edit made after an acknowledged writeback and keeps manual topics", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    await db.insert(sourceConnection).values({key: "zt", provider: "zotero", scopeKind: "group", externalScopeKey: "123", config: {}});
    const ingest = (expectedCursor: object, version: number, title?: string) => writeSourceIngestionBatch(db, {sourceConnectionKey: "zt", expectedCursor,
      nextCursor: {v: version}, mappingProfileVersion: "test", fetchedAt: new Date(), items: mapOpenAlexWork(work(version, "W123", title)).items});
    const key = (await ingest({}, 1)).itemKeys.W123!;
    const zoteroPolicy = {writebackConfig: {...config, sources: [{key: "zt", writebackEnabled: true}]}};
    await edit(db, key, {title: "Editor title", topics: ["T12345"]}, zoteroPolicy);
    await publishItemDraft(db, key, zoteroPolicy);
    const registry = new SourceWritebackAdapterRegistry([{provider: "zotero", readRecord: async () => null, readVersion: async () => null,
      write: async request => ({remoteVersion: "2026-09-12T10:00:00.000Z", sourceRecordKey: request.sourceRecordKey})}]);
    expect(await processNextSourceWritebackJob({database: db, registry, credentialResolver: async () => "key", sourceWritebackEnabled: () => true, workerId: "topics-test"}))
      .toMatchObject({status: "processed"});
    expect((await db.select().from(itemSourceLink).where(eq(itemSourceLink.itemKey, key)))[0]?.dirtyFields).toEqual([]);
    await ingest({v: 1}, 3, "Zotero title");
    expect((await db.select().from(item).where(eq(item.key, key)))[0]).toMatchObject({title: "Zotero title", topics: ["T12345"]});
    expect(await readSourceFields(db, key)).toEqual([]);
  });
});

it("drains multiple topic deliveries in one cycle and bounds very long creator lists", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    const keys: string[] = [];
    for (const title of ["First", "Second", "Third"]) {
      const draft = await createNativeItemDraft(db, {itemType: "Report", title, topics: ["T12260"]}, policy);
      await publishItemDraft(db, draft.itemKey, policy);
      keys.push(draft.itemKey);
    }
    await db.update(item).set({creators: Array.from({length: 1001}, (_, index) => ({creatorType: "author", name: `Author ${index}`, fieldMode: 1}))}).where(eq(item.key, keys[0]!));
    const delivered: Array<{itemKey: string; metadata: {creators: string[]}}> = [];
    await runTopicAssociationCycle(db, config, undefined, receiving(delivered));
    expect(delivered.map(body => body.itemKey).sort()).toEqual(keys.sort());
    expect(Math.max(...delivered.map(body => body.metadata.creators.length))).toBe(1000);
    expect((await db.select().from(topicAssociationDelivery)).every(row => row.nextAttemptAt === null && row.lastError === null)).toBe(true);
  });
});

it("sends waiting records in one call and holds back only a record Openscholar refused or that can't be built", async () => {
  await withIsolatedPublicationDatabase(async db => {
    await seedTopics(db);
    const keys: string[] = [];
    for (const title of ["First", "Second", "Third", "Fourth"]) {
      const draft = await createNativeItemDraft(db, {itemType: "Report", title, topics: ["T12260"]}, policy);
      await publishItemDraft(db, draft.itemKey, policy);
      keys.push(draft.itemKey);
    }
    await db.update(item).set({topics: ["not-a-topic"]}).where(eq(item.key, keys[3]!));
    const calls: string[] = [];
    await runTopicAssociationCycle(db, config, undefined, async (url, init) => {
      calls.push(new URL(String(url)).pathname);
      const {deliveries} = JSON.parse(String(init?.body)) as {deliveries: {itemKey: string; idempotencyKey: string; generation: number}[]};
      return Response.json({contractVersion: 1, receipts: deliveries.map(({itemKey, idempotencyKey, generation}) => itemKey === keys[1]
        ? {idempotencyKey, generation, error: {code: "CONFLICT"}}
        : {contractVersion: 1, idempotencyKey, generation, status: "applied"})});
    });
    expect(calls).toEqual(["/api/v1/evidence-libraries/topic-associations/batch"]);
    const rows = new Map((await db.select().from(topicAssociationDelivery)).map(row => [row.itemKey, row]));
    expect(rows.get(keys[1]!)).toMatchObject({attempts: 1, lastError: "Openscholar refused the topic delivery: CONFLICT"});
    expect(rows.get(keys[1]!)?.nextAttemptAt).not.toBeNull();
    for (const key of [keys[0]!, keys[2]!]) expect(rows.get(key)).toMatchObject({nextAttemptAt: null, lastError: null});
    expect(rows.get(keys[3]!)).toMatchObject({attempts: 1, payload: null});
    expect(rows.get(keys[3]!)?.lastError).toMatch(/^Topic delivery is invalid/);
  });
});
