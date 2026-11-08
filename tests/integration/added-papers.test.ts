import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { and, eq } from "drizzle-orm";
import { itemSourceLink, sourceConnection } from "@opendeved/evidence-library-core";
import { libraryConfigSchema } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { addedPaper } from "@/db/schema/source";
import { itemReview } from "@/db/schema/review";
import { item } from "@/db/schema/tables/item";
import { addPapers, type PaperLookup } from "@/lib/admin/added-papers-service";
import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { AdminValidationError } from "@/lib/admin/errors";
import { approveItemReview, correctItemReview, resolveItemReview } from "@/lib/admin/review-service";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { syncAddedPapers } from "@/lib/source-ingestion/added/sync";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { MemoryFileStorage } from "../helpers/file-storage";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [] });
const owner = { userId: "user_owner", name: "Amina Yusuf", role: "owner" } as const;
const creator = { userId: "user_creator", name: "Daniel Mensah", role: "creator" } as const;

/** An OpenAlex work as the API answers, titled by its version so a sync's refresh shows. */
const work = (id: number, title = `Work ${id}`, doi = `10.1000/w${id}`, published = "2020-01-01") => ({
	id: `https://openalex.org/W${id}`,
	doi: `https://doi.org/${doi}`,
	type: "article",
	title,
	publication_date: published,
	updated_date: "2026-11-08T10:00:00Z",
});

/** OpenAlex as the lookup and the sync both read it, holding `works`; and a DOI lookup holding `byDoi`. */
function services(works: ReturnType<typeof work>[], byDoi: Record<string, Record<string, unknown>> = {}) {
	const doiOf = (w: ReturnType<typeof work>) => w.doi.replace("https://doi.org/", "");
	const lookup: PaperLookup = {
		worksById: async (ids) => new Map(works.filter((w) => ids.includes(w.id.split("/").pop()!)).map((w) => [w.id.split("/").pop()!, w])),
		worksByDoi: async (dois) => new Map(works.filter((w) => dois.includes(doiOf(w))).map((w) => [doiOf(w), w])),
		recordByDoi: async (doi) => byDoi[doi] ?? null,
	};
	const openAlex = (async (input: string | URL) => {
		const url = new URL(String(input));
		const filter = url.searchParams.get("filter") ?? "";
		const ids = filter.match(/^ids\.openalex:([^,]+)/u)?.[1]?.split("|");
		const dois = filter.match(/^doi:([^,]+)/u)?.[1]?.split("|");
		const results = ids ? works.filter((w) => ids.includes(w.id.split("/").pop()!)) : works.filter((w) => dois?.includes(doiOf(w)));
		return Response.json({ meta: { count: results.length, ...(url.searchParams.has("cursor") ? { next_cursor: null } : {}) }, results });
	}) as typeof globalThis.fetch;
	return { lookup, fetch: openAlex };
}

async function sync(db: Database, fetch: typeof globalThis.fetch) {
	// PDFs need the attachment pipeline, which this test leaves out.
	await db.update(sourceConnection).set({ config: { downloadPdfs: false } }).where(eq(sourceConnection.key, ADDED_PAPERS_SOURCE_CONNECTION_KEY));
	const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, ADDED_PAPERS_SOURCE_CONNECTION_KEY));
	return syncAddedPapers({ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} }, { fetch });
}

const record = async (db: Database, key: string) => (await db.select().from(item).where(eq(item.key, key)))[0];
const linked = async (db: Database, key: string) =>
	(await db.select().from(itemSourceLink).where(and(eq(itemSourceLink.itemKey, key), eq(itemSourceLink.sourceConnectionKey, ADDED_PAPERS_SOURCE_CONNECTION_KEY)))).length > 0;

it("publishes an owner's paper at once, and the source's sync then keeps that same record up to date", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup, fetch } = services([work(1, "Teacher coaching in Kenya")]);
		const { results } = await addPapers(db, storage, config, { requestId: "r1", publish: true, actor: owner, papers: [{ openalexId: "https://openalex.org/W1" }] }, lookup);
		expect(results).toEqual([{ at: 0, outcome: "added", itemKey: expect.any(String), foundBy: "openalex" }]);
		const key = results[0]!.itemKey!;
		expect((await record(db, key))?.title).toBe("Teacher coaching in Kenya");
		expect(await linked(db, key)).toBe(true);
		expect((await db.select().from(addedPaper).where(eq(addedPaper.itemKey, key)))[0]).toMatchObject({ state: "accepted", openalexId: "W1", addedBy: "user_owner" });

		const refreshed = services([work(1, "Teacher coaching in Kenya, revised")]);
		await sync(db, refreshed.fetch);
		expect((await record(db, key))?.title).toBe("Teacher coaching in Kenya, revised");
		expect(await db.select({ key: item.key }).from(item)).toHaveLength(1);
	});
});

it("keeps a creator's paper in the review queue, out of the sync, until an editor approves it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup, fetch } = services([work(2)]);
		await expect(addPapers(db, storage, config, { requestId: "r2", publish: true, actor: creator, papers: [{ doi: "10.1000/w2" }] }, lookup)).rejects.toBeInstanceOf(AdminValidationError);
		const { results } = await addPapers(db, storage, config, { requestId: "r2", publish: false, actor: creator, papers: [{ doi: "https://doi.org/10.1000/W2" }] }, lookup);
		expect(results).toEqual([{ at: 0, outcome: "queued", itemKey: expect.any(String), foundBy: "openalex" }]);
		const key = results[0]!.itemKey!;
		expect(await record(db, key)).toBeUndefined();
		expect(await linked(db, key)).toBe(false);

		// The sync publishes nothing that waits for review.
		await sync(db, fetch);
		expect(await record(db, key)).toBeUndefined();

		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key));
		await approveItemReview(db, storage, { reviewId: review!.id, expectedRevision: review!.revision }, { userId: "user_editor", role: "editor" }, config);
		expect((await record(db, key))?.title).toBe("Work 2");
		expect(await linked(db, key)).toBe(true);
	});
});

it("answers a repeated request as before, and reports a paper already here instead of adding it again", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(3)]);
		const request = { requestId: "r3", publish: true, actor: owner, papers: [{ openalexId: "W3" }, { doi: "10.1000/w3" }, { doi: "not a doi" }] };
		const first = await addPapers(db, storage, config, request, lookup);
		expect(first.results.map((result) => result.outcome)).toEqual(["added", "existing", "not_found"]);
		expect((await addPapers(db, storage, config, request, lookup)).results.map((result) => result.outcome)).toEqual(["added", "added", "not_found"]);
		const other = await addPapers(db, storage, config, { ...request, requestId: "r4", papers: [{ openalexId: "W3" }] }, lookup);
		expect(other.results).toEqual([{ at: 0, outcome: "existing", itemKey: first.results[0]!.itemKey, foundBy: "openalex" }]);
		expect(await db.select().from(addedPaper)).toHaveLength(1);
	});
});

it("adds a paper OpenAlex doesn't have from its DOI, and links it to its work once OpenAlex has it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const doi = "10.68354/743355";
		const missing = services([], { [doi]: { itemType: "journalArticle", title: "School leadership support", DOI: doi } });
		const { results } = await addPapers(db, storage, config, { requestId: "r5", publish: true, actor: owner, papers: [{ doi }] }, missing.lookup);
		expect(results).toEqual([{ at: 0, outcome: "added", itemKey: expect.any(String), foundBy: "doi" }]);
		const key = results[0]!.itemKey!;
		expect((await record(db, key))?.title).toBe("School leadership support");
		// It belongs to the source from the start, and a scan of OpenAlex never withdraws it.
		expect(await linked(db, key)).toBe(true);
		expect((await sync(db, missing.fetch)).unresolved).toBe(1);
		expect((await record(db, key))?.deleted).toBe(0);

		const arrived = services([work(7, "School leadership support and growth", doi)]);
		expect((await sync(db, arrived.fetch)).unresolved).toBe(0);
		expect((await db.select().from(addedPaper).where(eq(addedPaper.itemKey, key)))[0]?.openalexId).toBe("W7");
		expect((await record(db, key))?.title).toBe("School leadership support and growth");
		expect(await db.select({ key: item.key }).from(item)).toHaveLength(1);

		// An OpenAlex search that finds the same work holds this record too, instead of making another.
		await db.insert(sourceConnection).values({ key: "oa-leadership", provider: "openalex", scopeKind: "query", config: { name: "Leadership", searchUrl: "/results/1", approvedQuery: { version: "v1", approvedAt: "2026-11-08T10:00:00Z", query: { search: "leadership" } }, downloadPdfs: false } });
		const [search] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-leadership"));
		await syncOpenAlexSource({ database: db, sourceConnection: search!, credentialResolver: async () => "test-key", heartbeat: async () => {} }, { fetch: (async () => Response.json({ meta: { count: 1, next_cursor: null }, results: [work(7, "School leadership support and growth", doi)] })) as typeof globalThis.fetch, sleep: async () => {} });
		expect(await db.select({ key: item.key }).from(item)).toHaveLength(1);
	});
});

it("keeps a reviewer's correction after the source's first sync, while the fields left alone follow OpenAlex", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(8, "teacher coaching kenya")]);
		const { results } = await addPapers(db, storage, config, { requestId: "r8", publish: false, actor: creator, papers: [{ openalexId: "W8" }] }, lookup);
		const key = results[0]!.itemKey!;
		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key));
		const record = review!.snapshot.records[0]!;
		const corrected = await correctItemReview(db, { reviewId: review!.id, expectedRevision: review!.revision, records: [{ ...record, payload: { ...record.payload, title: "Teacher coaching in Kenya" } }] }, { userId: "user_editor", role: "editor" });
		await approveItemReview(db, storage, { reviewId: corrected.id, expectedRevision: corrected.revision }, { userId: "user_editor", role: "editor" }, config);
		await sync(db, services([work(8, "teacher coaching kenya", "10.1000/w8", "2020-06-15")]).fetch);
		const [synced] = await db.select().from(item).where(eq(item.key, key));
		expect(synced?.title).toBe("Teacher coaching in Kenya");
		expect(synced?.date).toContain("2020-06-15");
	});
});

it("finishes sending a paper whose first request stopped before its review was submitted", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(9)]);
		const request = { requestId: "r9", publish: false, actor: creator, papers: [{ openalexId: "W9" }] };
		const { results } = await addPapers(db, storage, config, request, lookup);
		const key = results[0]!.itemKey!;
		// As if the request had stopped after making the record, before submitting it.
		await db.delete(itemReview).where(eq(itemReview.itemKey, key));
		expect((await addPapers(db, storage, config, request, lookup)).results).toEqual([{ at: 0, outcome: "queued", itemKey: key, foundBy: "openalex" }]);
		expect(await db.select().from(itemReview).where(and(eq(itemReview.itemKey, key), eq(itemReview.state, "pending")))).toHaveLength(1);
	});
});

const editor = { userId: "user_editor", role: "editor" } as const;

/** An OpenAlex search source that finds `found`, synced once. */
async function searchFinds(db: Database, found: ReturnType<typeof work>[]) {
	await db.insert(sourceConnection).values({ key: "oa-search", provider: "openalex", scopeKind: "query", config: { name: "Search", searchUrl: "/results/1", approvedQuery: { version: "v1", approvedAt: "2026-11-08T10:00:00Z", query: { search: "teachers" } }, downloadPdfs: false } });
	const [search] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, "oa-search"));
	await syncOpenAlexSource({ database: db, sourceConnection: search!, credentialResolver: async () => "test-key", heartbeat: async () => {} }, { fetch: (async () => Response.json({ meta: { count: found.length, next_cursor: null }, results: found })) as typeof globalThis.fetch, sleep: async () => {} });
}

it("leaves a paper waiting for review unpublished when an OpenAlex search finds the same work", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const { lookup } = services([work(10)]);
		const { results } = await addPapers(db, new MemoryFileStorage(), config, { requestId: "r10", publish: false, actor: creator, papers: [{ openalexId: "W10" }] }, lookup);
		await searchFinds(db, [work(10)]);
		expect(await record(db, results[0]!.itemKey!)).toBeUndefined();
	});
});

it("doesn't submit again a paper whose review was returned when its request is replayed", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const { lookup } = services([work(11)]);
		const request = { requestId: "r11", publish: false, actor: creator, papers: [{ openalexId: "W11" }] };
		const key = (await addPapers(db, new MemoryFileStorage(), config, request, lookup)).results[0]!.itemKey!;
		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key));
		await resolveItemReview(db, { reviewId: review!.id, expectedRevision: review!.revision, action: "returned", note: "Outside this community's focus" }, editor);
		expect((await addPapers(db, new MemoryFileStorage(), config, request, lookup)).results).toEqual([{ at: 0, outcome: "returned", itemKey: key, foundBy: "openalex" }]);
		expect(await db.select().from(itemReview).where(and(eq(itemReview.itemKey, key), eq(itemReview.state, "pending")))).toHaveLength(0);
	});
});

it("keeps a correction to a paper found only by its DOI once OpenAlex has the work", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const doi = "10.1000/doi-only";
		const { lookup } = services([], { [doi]: { itemType: "journalArticle", title: "school leadership", DOI: doi } });
		const key = (await addPapers(db, storage, config, { requestId: "r12", publish: false, actor: creator, papers: [{ doi }] }, lookup)).results[0]!.itemKey!;
		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key));
		const sent = review!.snapshot.records[0]!;
		const corrected = await correctItemReview(db, { reviewId: review!.id, expectedRevision: review!.revision, records: [{ ...sent, payload: { ...sent.payload, title: "School leadership support" } }] }, editor);
		await approveItemReview(db, storage, { reviewId: corrected.id, expectedRevision: corrected.revision }, editor, config);
		await sync(db, services([work(12, "school leadership", doi)]).fetch);
		expect((await record(db, key))?.title).toBe("School leadership support");
	});
});
