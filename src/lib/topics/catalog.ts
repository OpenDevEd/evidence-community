import { readBoundedResponse } from "@/lib/source-ingestion/read-bounded-response";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "@/db/database-schema";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { topicCatalogCache } from "@/db/schema/topics";
import { topicCatalogRequestSchema, topicCatalogResponseSchema, topicDetailResponseSchema, topicNodeSchema, topicNodeIdSchema, type TopicNode } from "./contract";

export type TopicCatalogContext = { database: Pick<Database, "select" | "insert">; config: Pick<LibraryServerConfig, "authentication">; fetch?: typeof fetch };
const FRESH_MS = 24 * 3600_000;
const STALE_MS = 7 * FRESH_MS;

export class TopicServiceError extends Error {
  constructor(public readonly status: number) { super(`Topics service returned ${status}`); this.name = "TopicServiceError"; }
}

async function serviceRequest(path: string, body: object, context: TopicCatalogContext) {
  const service = context.config.authentication.openScholar;
  const response = await (context.fetch ?? fetch)(new URL(path, service.convexSiteUrl), {
    method: "POST", headers: {"Content-Type": "application/json", Authorization: `Bearer ${service.machineCredential}`},
    body: JSON.stringify({...body, contractVersion: 1, libraryId: service.libraryId}), signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) { await response.body?.cancel(); throw new TopicServiceError(response.status); }
  const text = new TextDecoder().decode(await readBoundedResponse(response, 2_000_000, 10000, 10000));
  return JSON.parse(text) as unknown;
}

type CacheEntry = Pick<typeof topicCatalogCache.$inferInsert, "id" | "kind" | "payload">;
/** The catalog envelope that ID lookups answered from the cache repeat. */
const CATALOG_META_ID = "catalog";
const catalogMetaSchema = topicCatalogResponseSchema.pick({revision: true, publicBaseUrl: true});

async function saveCache(context: TopicCatalogContext, entries: CacheEntry[]) {
  const fetchedAt = new Date();
  await context.database.insert(topicCatalogCache).values(entries.map(entry => ({...entry, fetchedAt})))
    .onConflictDoUpdate({target: topicCatalogCache.id, set: {kind: sql`excluded."kind"`, payload: sql`excluded."payload"`, fetchedAt}});
}

/** Map the public catalog query string to exactly one catalog operation. */
export function parseTopicCatalogParams(params: URLSearchParams, libraryId: string) {
  return topicCatalogRequestSchema.safeParse({contractVersion: 1, libraryId,
    ...(params.has("ids") ? {ids: params.get("ids")!.split(",")} : {}),
    ...(params.has("query") ? {query: params.get("query")} : {}),
    ...(params.has("parent") || (!params.has("ids") && !params.has("query")) ? {parent: params.get("parent") || null} : {}),
    cursor: params.get("cursor"), limit: params.has("limit") ? Number(params.get("limit")) : 100,
  });
}

async function readTopicCatalog(request: Omit<z.input<typeof topicCatalogRequestSchema>, "contractVersion" | "libraryId">, context: TopicCatalogContext) {
  const body = topicCatalogRequestSchema.parse({...request, contractVersion: 1, libraryId: context.config.authentication.openScholar.libraryId});
  const response = topicCatalogResponseSchema.parse(await serviceRequest("/api/v1/evidence-libraries/topics/catalog", body, context));
  await saveCache(context, [{id: CATALOG_META_ID, kind: "meta", payload: {revision: response.revision, publicBaseUrl: response.publicBaseUrl}},
    ...response.nodes.map(node => ({id: node.id, kind: "node", payload: node}))]);
  return response;
}

/** The public route answers ID lookups from the stored catalog; only missing or old nodes reach OpenScholar. */
export async function readPublicTopicCatalog(request: z.output<typeof topicCatalogRequestSchema>, context: TopicCatalogContext) {
  if (!request.ids) return readTopicCatalog(request, context);
  const nodes = await resolveTopicNodes(request.ids, context, {allowUnknown: true});
  const [meta] = await context.database.select().from(topicCatalogCache).where(eq(topicCatalogCache.id, CATALOG_META_ID)).limit(1);
  return {contractVersion: 1 as const, ...catalogMetaSchema.parse(meta?.payload), nodes, nextCursor: null};
}

type CachedTopic = typeof topicCatalogCache.$inferSelect;

function cachedNode(row: CachedTopic | undefined, maxAgeMs: number) {
  return row && Date.now() - row.fetchedAt.getTime() < maxAgeMs ? topicNodeSchema.parse(row.payload) : undefined;
}

/** Fetch one batch; if the service fails, fall back to cache rows that are not yet stale. */
async function resolveTopicBatch(batch: string[], byId: Map<string, CachedTopic>, result: Map<string, TopicNode>, context: TopicCatalogContext, options: {allowUnknown?: boolean}) {
  try {
    const response = await readTopicCatalog({ids: batch}, context);
    for (const node of response.nodes) result.set(node.id, node);
    for (const id of batch) if (!options.allowUnknown && !result.has(id)) throw new TopicServiceError(404);
  } catch (error) {
    if (error instanceof TopicServiceError && error.status === 404) throw error;
    console.error("Topic catalog lookup failed", {libraryId: context.config.authentication.openScholar.libraryId, ids: batch, error});
    applyStaleNodes(batch, byId, result, error);
  }
}

function applyStaleNodes(batch: string[], byId: Map<string, CachedTopic>, result: Map<string, TopicNode>, error: unknown) {
  for (const id of batch) {
    const node = cachedNode(byId.get(id), STALE_MS);
    if (!node) throw error;
    result.set(id, node);
  }
}

export async function resolveTopicNodes(ids: readonly string[], context: TopicCatalogContext, options: {allowUnknown?: boolean} = {}): Promise<TopicNode[]> {
  if (!ids.length) return [];
  const unique = [...new Set(ids)].filter(id => !options.allowUnknown || topicNodeIdSchema.safeParse(id).success);
  const cached = await context.database.select().from(topicCatalogCache).where(and(eq(topicCatalogCache.kind, "node"), inArray(topicCatalogCache.id, unique)));
  const byId = new Map(cached.map(row => [row.id, row]));
  const result = new Map<string, TopicNode>();
  const missing = unique.filter(id => {
    const node = cachedNode(byId.get(id), FRESH_MS);
    if (node) result.set(id, node);
    return !node;
  });
  for (let offset = 0; offset < missing.length; offset += 100) await resolveTopicBatch(missing.slice(offset, offset + 100), byId, result, context, options);
  return unique.flatMap(id => result.has(id) ? [result.get(id)!] : []);
}

export async function resolveTopicAncestry(ids: readonly string[], context: TopicCatalogContext, options: {allowUnknown?: boolean} = {}) {
  const all = new Map<string, TopicNode>();
  let pending = [...new Set(ids)];
  for (let depth = 0; pending.length && depth < 4; depth++) {
    const nodes = await resolveTopicNodes(pending, context, options);
    for (const node of nodes) all.set(node.id, node);
    pending = [...new Set(nodes.flatMap(node => node.parent && !all.has(node.parent) ? [node.parent] : []))];
  }
  if (pending.length) throw new Error("Topic hierarchy exceeds four levels");
  return [...all.keys()].sort();
}

export async function readTopicDetail(topicId: string, context: TopicCatalogContext) {
  const cacheId = `detail:${topicId}`;
  const [cached] = await context.database.select().from(topicCatalogCache).where(eq(topicCatalogCache.id, cacheId)).limit(1);
  if (cached && Date.now() - cached.fetchedAt.getTime() < FRESH_MS) return topicDetailResponseSchema.parse(cached.payload);
  try {
    const detail = topicDetailResponseSchema.parse(await serviceRequest("/api/v1/evidence-libraries/topics/detail", {topicId}, context));
    await saveCache(context, [{id: cacheId, kind: "detail", payload: detail}]);
    return detail;
  } catch (error) {
    if (error instanceof TopicServiceError && error.status === 404) throw error;
    console.error("Topic detail lookup failed", {libraryId: context.config.authentication.openScholar.libraryId, topicId, error});
    if (cached && Date.now() - cached.fetchedAt.getTime() < STALE_MS) return topicDetailResponseSchema.parse(cached.payload);
    throw error;
  }
}
