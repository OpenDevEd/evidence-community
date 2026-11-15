import { expect, it, vi } from "vitest";
import { fetch as transport, Response as TransportResponse } from "undici";
vi.mock("server-only", () => ({}));
// A report's PDF is downloaded from Openscholar through the public fetch.
vi.mock("undici", async (importOriginal) => ({ ...(await importOriginal<typeof import("undici")>()), fetch: vi.fn() }));

import { and, desc, eq, isNull } from "drizzle-orm";
import { itemDraft, itemSourceLink, outbox, sourceConnection } from "@opendeved/evidence-library-core";
import { libraryConfigSchema } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { addedPaper } from "@/db/schema/source";
import { readerAccount, readerUser } from "@/db/schema/tables/reader";
import { itemReview } from "@/db/schema/review";
import { item } from "@/db/schema/tables/item";
import { institutionCountry } from "@/db/schema/tables/institutionCountry";
import { itemFieldOverride } from "@/db/schema/topics";
import { addedPapersSettings, removeAddedPaper, setAddedPapersSettings } from "@/lib/admin/added-papers-manage";
import { listAddedPapers, previewPapers } from "@/lib/admin/added-papers-reads";
import { addPapers, SUGGESTIONS_PER_PERSON_DAY, type PaperLookup } from "@/lib/admin/added-papers-service";
import { previewImportRecords } from "@/lib/admin/item-import-service";
import { getAdminReviewSnapshot } from "@/lib/admin/review-query";
import { openAlexWorkOf } from "@/lib/admin/library-query-service";
import { runSubmissionStatusCycle } from "@/lib/admin/submission-status";
import { submissionStatusDelivery } from "@/db/schema/source";
import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { REPORTS_PATH, type OpenscholarReport } from "@/lib/openscholar-service";
import { AdminValidationError } from "@/lib/admin/errors";
import { createNativeItemDraft, publishItemDraft, unpublishNativeItem } from "@/lib/admin/native-item-service";
import { approveItemReview, correctItemReview, resolveItemReview, submitItemReview } from "@/lib/admin/review-service";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { syncAddedPapers } from "@/lib/source-ingestion/added/sync";
import { readItemSources } from "@/lib/search-index/item-sources";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { itemFilePublication } from "@/db/schema/source";
import { createOpenAlexAttachmentProcessor } from "@/lib/source-ingestion/openalex/attachment-processor";
import { syncDoiRecords } from "@/lib/source-ingestion/openscholar/doi-records";
import { MemoryFileStorage, createPdf } from "../helpers/file-storage";
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
function services(works: ReturnType<typeof work>[], byDoi: Record<string, Record<string, unknown>> = {}, reports: ReadonlyMap<string, OpenscholarReport> = new Map()) {
	const doiOf = (w: ReturnType<typeof work>) => w.doi.replace("https://doi.org/", "");
	const askedOfOpenAlex: string[] = [];
	const lookup: PaperLookup = {
		worksById: async (ids) => new Map(works.filter((w) => ids.includes(w.id.split("/").pop()!)).map((w) => [w.id.split("/").pop()!, w])),
		worksByDoi: async (dois) => new Map(works.filter((w) => dois.includes(doiOf(w))).map((w) => [doiOf(w), w])),
		recordByDoi: async (doi) => byDoi[doi] ?? null,
		// Openscholar following its own links: a paper only its index has is W30's DOI; anything else, nothing.
		papersAtLinks: async (links) => links.map((link) => (link.includes("OS30") ? { openalexId: null, doi: "10.1000/w30" } : null)),
		reportsByDoi: async (dois) => new Map(dois.flatMap((doi) => (reports.has(doi) ? [[doi, reports.get(doi)!] as const] : []))),
	};
	const openAlex = (async (input: string | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		// The sync asks Openscholar which accepted papers are its reports.
		if (url.pathname === REPORTS_PATH) return Response.json({ reports: (JSON.parse(String(init?.body)) as { dois: string[] }).dois.map((doi) => reports.get(doi) ?? null) });
		// And OpenAlex where the institutions those reports name are.
		if (url.pathname === "/institutions") {
			const ids = url.searchParams.get("filter")!.replace("openalex:", "").split("|");
			return Response.json({ meta: { count: ids.length }, results: ids.map((id) => ({ id: `https://openalex.org/${id}`, geo: { city: "Kigali", latitude: -1.95, longitude: 30.06 } })) });
		}
		const filter = url.searchParams.get("filter") ?? "";
		askedOfOpenAlex.push(filter);
		const ids = filter.match(/^ids\.openalex:([^,]+)/u)?.[1]?.split("|");
		const dois = filter.match(/^doi:([^,]+)/u)?.[1]?.split("|");
		const results = ids ? works.filter((w) => ids.includes(w.id.split("/").pop()!)) : works.filter((w) => dois?.includes(doiOf(w)));
		return Response.json({ meta: { count: results.length, ...(url.searchParams.has("cursor") ? { next_cursor: null } : {}) }, results });
	}) as typeof globalThis.fetch;
	return { lookup, fetch: openAlex, askedOfOpenAlex };
}

async function sync(db: Database, fetch: typeof globalThis.fetch, storage = new MemoryFileStorage()) {
	// OpenAlex works' PDFs stay off here; a report's PDF is always hosted, through the same PDF stage.
	await db.update(sourceConnection).set({ config: { downloadPdfs: false } }).where(eq(sourceConnection.key, ADDED_PAPERS_SOURCE_CONNECTION_KEY));
	const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, ADDED_PAPERS_SOURCE_CONNECTION_KEY));
	const attachmentProcessor = createOpenAlexAttachmentProcessor({ database: db, storage, maxPdfBytes: 20 * 1024 * 1024 });
	return syncAddedPapers({ database: db, sourceConnection: connection!, credentialResolver: async () => "test-key", heartbeat: async () => {} }, { fetch, service: config.authentication.openScholar, attachmentProcessor });
}

const record = async (db: Database, key: string) => (await db.select().from(item).where(eq(item.key, key)))[0];
const linked = async (db: Database, key: string) =>
	(await db.select().from(itemSourceLink).where(and(eq(itemSourceLink.itemKey, key), eq(itemSourceLink.sourceConnectionKey, ADDED_PAPERS_SOURCE_CONNECTION_KEY)))).length > 0;

it("publishes an owner's paper at once, and the source's sync then keeps that same record up to date", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup, fetch } = services([work(1, "Teacher coaching in Kenya")]);
		const { results } = await addPapers(db, storage, config, { requestId: "r1", publish: true, actor: owner, papers: [{ openalexId: "https://openalex.org/W1" }] }, lookup);
		expect(results).toMatchObject([{ at: 0, outcome: "added", itemKey: expect.any(String), foundBy: "openalex" }]);
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
		expect(results).toMatchObject([{ at: 0, outcome: "queued", itemKey: expect.any(String), foundBy: "openalex" }]);
		const key = results[0]!.itemKey!;
		expect(await record(db, key)).toBeUndefined();
		expect(await linked(db, key)).toBe(false);
		// Its reviewer opens it on Openscholar while it waits, before it has a source link.
		expect(await openAlexWorkOf(db, key)).toBe("W2");

		// The sync publishes nothing that waits for review.
		await sync(db, fetch);
		expect(await record(db, key)).toBeUndefined();

		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key));
		await approveItemReview(db, storage, { reviewId: review!.id, expectedRevision: review!.revision }, { userId: "user_editor", role: "editor" }, config);
		expect((await record(db, key))?.title).toBe("Work 2");
		expect(await linked(db, key)).toBe(true);
		// Its search document, and so Openscholar's copy, names its work.
		expect((await readItemSources(db, [key])).workOf(key)).toBe("W2");
	});
});

it("adds a paper again once its record was removed, as a new record", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(40)]);
		const queued = await addPapers(db, storage, config, { requestId: "r40", publish: false, actor: creator, papers: [{ openalexId: "W40" }] }, lookup);
		const first = queued.results[0]!.itemKey!;
		// The team removes the waiting draft: its review is gone with it, and the paper is no longer in the community.
		await db.delete(itemReview).where(eq(itemReview.itemKey, first));
		await db.delete(itemDraft).where(eq(itemDraft.itemKey, first));
		const again = await addPapers(db, storage, config, { requestId: "r41", publish: true, actor: owner, papers: [{ openalexId: "W40" }] }, lookup);
		expect(again.results).toMatchObject([{ outcome: "added", foundBy: "openalex" }]);
		expect(again.results[0]!.itemKey).not.toBe(first);
		expect(await db.select({ itemKey: addedPaper.itemKey }).from(addedPaper)).toEqual([{ itemKey: again.results[0]!.itemKey }]);
	});
});

it("adds a paper again after the team removed it from the community, as a new record", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(42)]);
		const published = await addPapers(db, storage, config, { requestId: "r42", publish: true, actor: owner, papers: [{ openalexId: "W42" }] }, lookup);
		const first = published.results[0]!.itemKey!;
		expect(await removeAddedPaper(db, first, { userId: owner.userId, role: "owner" })).toBe("removed");
		const again = await addPapers(db, storage, config, { requestId: "r43", publish: true, actor: owner, papers: [{ openalexId: "W42" }] }, lookup);
		expect(again.results).toMatchObject([{ outcome: "added" }]);
		expect(again.results[0]!.itemKey).not.toBe(first);
		expect(await db.select({ itemKey: addedPaper.itemKey, state: addedPaper.state }).from(addedPaper)).toEqual([{ itemKey: again.results[0]!.itemKey, state: "accepted" }]);
	});
});

it("answers a DOI-only paper the admin unpublished as already here when it's added again, without failing", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const doi = "10.68354/743356";
		const missing = services([], { [doi]: { itemType: "journalArticle", title: "School leadership", DOI: doi } });
		const { results } = await addPapers(db, storage, config, { requestId: "r44", publish: true, actor: owner, papers: [{ doi }] }, missing.lookup);
		await unpublishNativeItem(db, results[0]!.itemKey!);
		const again = await addPapers(db, storage, config, { requestId: "r45", publish: true, actor: owner, papers: [{ doi }] }, missing.lookup);
		expect(again.results).toMatchObject([{ outcome: "existing", itemKey: results[0]!.itemKey }]);
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
		expect(results).toMatchObject([{ at: 0, outcome: "added", itemKey: expect.any(String), foundBy: "doi" }]);
		const key = results[0]!.itemKey!;
		expect((await record(db, key))?.title).toBe("School leadership support");
		// It belongs to the source from the start, and a scan of OpenAlex never withdraws it.
		expect(await linked(db, key)).toBe(true);
		expect((await sync(db, missing.fetch)).unresolved).toBe(1);
		// Found by its DOI alone, it has no work for the inspector to open on Openscholar.
		expect(await openAlexWorkOf(db, key)).toBeNull();
		expect((await record(db, key))?.deleted).toBe(0);

		const arrived = services([work(7, "School leadership support and growth", doi)]);
		expect((await sync(db, arrived.fetch)).unresolved).toBe(0);
		expect((await db.select().from(addedPaper).where(eq(addedPaper.itemKey, key)))[0]?.openalexId).toBe("W7");
		expect(await openAlexWorkOf(db, key)).toBe("W7");
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
		expect((await addPapers(db, storage, config, request, lookup)).results).toMatchObject([{ at: 0, outcome: "queued", itemKey: key, foundBy: "openalex" }]);
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

it("refuses to approve a paper another source brought in while it waited, leaving one public record", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(13)]);
		const key = (await addPapers(db, storage, config, { requestId: "r13", publish: false, actor: creator, papers: [{ openalexId: "W13" }] }, lookup)).results[0]!.itemKey!;
		await searchFinds(db, [work(13)]);
		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key));
		await expect(approveItemReview(db, storage, { reviewId: review!.id, expectedRevision: review!.revision }, editor, config)).rejects.toBeInstanceOf(AdminValidationError);
		expect(await record(db, key)).toBeUndefined();
		expect(await db.select({ key: item.key }).from(item)).toHaveLength(1);
	});
});

it("submits a returned paper again when a new request sends it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(14)]);
		const key = (await addPapers(db, storage, config, { requestId: "r14", publish: false, actor: creator, papers: [{ openalexId: "W14" }] }, lookup)).results[0]!.itemKey!;
		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key));
		await resolveItemReview(db, { reviewId: review!.id, expectedRevision: review!.revision, action: "returned", note: "Add the abstract" }, editor);
		const again = await addPapers(db, storage, config, { requestId: "r15", publish: true, actor: owner, papers: [{ openalexId: "W14" }] }, lookup);
		expect(again.results).toMatchObject([{ at: 0, outcome: "added", itemKey: key, foundBy: "openalex" }]);
		expect((await record(db, key))?.title).toBe("Work 14");
	});
});

it("leaves a paper returned when any request that sent it is replayed, the one that sent it again included", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(16)]);
		const send = (requestId: string) => addPapers(db, storage, config, { requestId, publish: false, actor: creator, papers: [{ openalexId: "W16" }] }, lookup);
		const returnLatest = async (key: string) => {
			const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key)).orderBy(desc(itemReview.submittedAt)).limit(1);
			await resolveItemReview(db, { reviewId: review!.id, expectedRevision: review!.revision, action: "returned", note: "Not in scope" }, editor);
		};
		const key = (await send("r16")).results[0]!.itemKey!;
		await returnLatest(key);
		expect((await send("r17")).results).toMatchObject([{ outcome: "queued", itemKey: key }]);
		await returnLatest(key);
		// Replayed, neither request sends it a third time.
		expect((await send("r17")).results).toMatchObject([{ outcome: "returned", itemKey: key }]);
		expect((await send("r16")).results).toMatchObject([{ outcome: "returned", itemKey: key }]);
		expect(await db.select().from(itemReview).where(and(eq(itemReview.itemKey, key), eq(itemReview.state, "pending")))).toEqual([]);
	});
});

it("previews what adding would find without saving anything, and lists added papers by where they stand", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const doi = "10.1000/doi-only-list";
		const { lookup } = services([work(20, "Teacher coaching in Kenya"), work(21, "Lesson study"), work(30, "Peer tutoring")], { [doi]: { itemType: "journalArticle", title: "School leadership", DOI: doi, date: "2026-03-01" } });
		await addPapers(db, storage, config, { requestId: "r20", publish: true, actor: owner, papers: [{ openalexId: "W20" }] }, lookup);
		await addPapers(db, storage, config, { requestId: "r21", publish: false, actor: creator, papers: [{ openalexId: "W21" }] }, lookup);

		const preview = await previewPapers(db, config, [{ openalexId: "W20" }, { openalexId: "W21" }, { doi }, { doi: "nothing" }], lookup);
		expect(preview.results.map((result) => result.outcome)).toEqual(["existing", "queued", "found", "not_found"]);
		expect(preview.results[2]).toMatchObject({ foundBy: "doi", paper: { title: "School leadership", year: 2026, doi } });
		expect(await db.select().from(addedPaper)).toHaveLength(2);

		// Openscholar's own pages and its index's papers name papers too; a record page Openscholar finds nothing at is said in its place.
		const linked = await previewPapers(db, config, [{ link: "https://dev.openscholar.ai/papers/W20/teacher-coaching" }, { link: "https://openscholar.ai/papers/OS30" }, { link: "https://other.example.org/lib/ABCD2345" }, { openalexId: "https://openscholar.ai/papers/W21/x" }], lookup);
		expect(linked.results.map((result) => result.outcome)).toEqual(["existing", "found", "not_found", "queued"]);
		expect(linked.results[1]).toMatchObject({ paper: { doi: "10.1000/w30" } });
		expect(linked.results[2]).toMatchObject({ message: "Openscholar finds no paper at this address." });

		await addPapers(db, storage, config, { requestId: "r22", publish: true, actor: owner, papers: [{ doi }] }, lookup);
		const [returned] = await db.select().from(itemReview).where(and(eq(itemReview.state, "pending")));
		await resolveItemReview(db, { reviewId: returned!.id, expectedRevision: returned!.revision, action: "returned", note: "Not about teachers" }, editor);
		const first = await listAddedPapers(db, { cursor: null, limit: 2 });
		const second = await listAddedPapers(db, { cursor: first.next, limit: 2 });
		expect([...first.papers, ...second.papers].map((paper) => [paper.title, paper.status, paper.note])).toEqual([
			["School leadership", "doi_only", null],
			["Lesson study", "returned", "Not about teachers"],
			["Teacher coaching in Kenya", "live", null],
		]);
		expect(second.next).toBeNull();
		expect(first.counts).toEqual({ total: 3, live: 2, waiting: 0 });
		// A returned paper previews as returned: adding it again sends it again.
		expect((await previewPapers(db, config, [{ openalexId: "W21" }], lookup)).results[0]?.outcome).toBe("returned");
		// It's the reviewer's answer, not the queue's to withdraw.
		await expect(removeAddedPaper(db, first.papers[1]!.itemKey, { userId: creator.userId, role: "creator" })).rejects.toBeInstanceOf(AdminValidationError);

		// A paper an editor unpublished is off the community, so it's no longer listed or counted as live.
		await unpublishNativeItem(db, first.papers[0]!.itemKey);
		const after = await listAddedPapers(db, { cursor: null, limit: 5 });
		expect(after.papers.map((paper) => paper.title)).toEqual(["Lesson study", "Teacher coaching in Kenya"]);
		expect(after.counts).toEqual({ total: 2, live: 1, waiting: 0 });
	});
});

it("pages through papers added together, which share their moment, without skipping any", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const { lookup } = services([work(30), work(31), work(32)]);
		await addPapers(db, new MemoryFileStorage(), config, { requestId: "r30", publish: false, actor: creator, papers: [{ openalexId: "W30" }, { openalexId: "W31" }, { openalexId: "W32" }] }, lookup);
		const first = await listAddedPapers(db, { cursor: null, limit: 2 });
		const second = await listAddedPapers(db, { cursor: first.next, limit: 2 });
		expect(new Set([...first.papers, ...second.papers].map((paper) => paper.openalexId))).toEqual(new Set(["W30", "W31", "W32"]));
		expect(second.next).toBeNull();
	});
});

it("withdraws a queued paper only for the person who sent it, and unpublishes a live one only for an editor", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup, fetch } = services([work(40), work(41)]);
		const queued = (await addPapers(db, storage, config, { requestId: "r40", publish: false, actor: creator, papers: [{ openalexId: "W40" }] }, lookup)).results[0]!.itemKey!;
		const live = (await addPapers(db, storage, config, { requestId: "r41", publish: true, actor: owner, papers: [{ openalexId: "W41" }] }, lookup)).results[0]!.itemKey!;

		await expect(removeAddedPaper(db, queued, { userId: "user_other", role: "creator" })).rejects.toBeInstanceOf(AdminValidationError);
		expect(await removeAddedPaper(db, queued, { userId: creator.userId, role: "creator" })).toBe("withdrawn");
		await expect(removeAddedPaper(db, live, { userId: creator.userId, role: "creator" })).rejects.toBeInstanceOf(AdminValidationError);
		expect(await removeAddedPaper(db, live, { userId: owner.userId, role: "owner" })).toBe("removed");
		expect((await listAddedPapers(db, { cursor: null, limit: 5 })).papers).toEqual([]);

		// The sync leaves the removed paper off the community; sending the withdrawn one again queues it again.
		await sync(db, fetch);
		expect((await record(db, live))?.deleted).toBe(1);
		await addPapers(db, storage, config, { requestId: "r42", publish: false, actor: creator, papers: [{ openalexId: "W40" }] }, lookup);
		expect((await listAddedPapers(db, { cursor: null, limit: 5 })).papers.map((paper) => [paper.itemKey, paper.status])).toEqual([[queued, "queued"]]);
	});
});

it("pauses the source and turns its PDFs off and on", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		expect(await addedPapersSettings(db)).toEqual({ enabled: true, downloadPdfs: true });
		await setAddedPapersSettings(db, { enabled: false });
		expect(await addedPapersSettings(db)).toEqual({ enabled: false, downloadPdfs: true });
		// A change to one setting leaves the other as it is, even one written since it was read.
		await setAddedPapersSettings(db, { downloadPdfs: false });
		expect(await addedPapersSettings(db)).toEqual({ enabled: false, downloadPdfs: false });
		await setAddedPapersSettings(db, { enabled: true, downloadPdfs: false });
		const [connection] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, ADDED_PAPERS_SOURCE_CONNECTION_KEY));
		expect(connection).toMatchObject({ status: "active", config: { downloadPdfs: false } });
	});
});

it("takes suggestions from someone outside the team into the review queue only, names them there, and holds them to a daily number", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const reader = { userId: "user_reader", name: "Grace Otieno", email: "grace@openscholar.example", role: "reader" } as const;
		const works = Array.from({ length: SUGGESTIONS_PER_PERSON_DAY + 1 }, (_, at) => work(100 + at));
		const { lookup } = services(works);
		await expect(addPapers(db, storage, config, { requestId: "s0", publish: true, actor: reader, papers: [{ openalexId: "W100" }] }, lookup)).rejects.toBeInstanceOf(AdminValidationError);
		const { results } = await addPapers(db, storage, config, { requestId: "s1", publish: false, actor: reader, papers: [{ openalexId: "W100" }] }, lookup);
		expect(results[0]).toMatchObject({ outcome: "queued" });
		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, results[0]!.itemKey!));
		expect(await getAdminReviewSnapshot(db, review!.id, { topicsEnabled: false, config })).toMatchObject({ submittedBy: "user_reader", submittedByName: "Grace Otieno", suggested: true });
		// Their email reaches only whoever decides the review: first as Openscholar sent it with the paper.
		expect(await getAdminReviewSnapshot(db, review!.id, { topicsEnabled: false, config, senderEmail: true })).toMatchObject({ submittedByEmail: "grace@openscholar.example" });
		expect(await getAdminReviewSnapshot(db, review!.id, { topicsEnabled: false, config })).toMatchObject({ submittedByEmail: null });
		// Once they have signed in to the library, their account gives their photo and current address, never the sign-in one.
		await db.insert(readerUser).values({ id: "reader-grace", name: "Grace O.", email: "user_reader@readers.openscholar.invalid", contactEmail: "grace@example.org", image: "https://example.org/grace.jpg" });
		await db.insert(readerAccount).values({ id: "account-grace", accountId: "user_reader", providerId: "openscholar", userId: "reader-grace" });
		const sender = { submittedByName: "Grace Otieno", submittedByImage: "https://example.org/grace.jpg" };
		expect(await getAdminReviewSnapshot(db, review!.id, { topicsEnabled: false, config, senderEmail: true })).toMatchObject({ ...sender, submittedByEmail: "grace@example.org" });
		expect(await getAdminReviewSnapshot(db, review!.id, { topicsEnabled: false, config })).toMatchObject({ ...sender, submittedByEmail: null });
		// They withdraw their own suggestion, as a Creator does.
		expect(await removeAddedPaper(db, results[0]!.itemKey!, { userId: "user_reader", role: "creator" })).toBe("withdrawn");

		// One short of the day's number, a request sent again with one more paper counts only the new one.
		await addPapers(db, storage, config, { requestId: "s1b", publish: false, actor: reader, papers: [{ openalexId: works[1]!.id }] }, lookup);
		await addPapers(db, storage, config, { requestId: "s2", publish: false, actor: reader, papers: works.slice(4).map((w) => ({ openalexId: w.id })) }, lookup);
		expect(await db.select().from(addedPaper)).toHaveLength(SUGGESTIONS_PER_PERSON_DAY - 1);
		const resent = { requestId: "s1b", publish: false, actor: reader, papers: [{ openalexId: works[1]!.id }, { openalexId: works[2]!.id }] };
		expect((await addPapers(db, storage, config, resent, lookup)).results.map((result) => result.outcome)).toEqual(["queued", "queued"]);

		// Past it, a request adds nothing; the team isn't held to it.
		const more = [{ openalexId: "W9999" }];
		const { lookup: moreLookup } = services([...works, work(9999)]);
		await expect(addPapers(db, storage, config, { requestId: "s3", publish: false, actor: reader, papers: more }, moreLookup)).rejects.toThrow(/no more suggested papers/);
		expect(await db.select().from(addedPaper)).toHaveLength(SUGGESTIONS_PER_PERSON_DAY);
		expect((await addPapers(db, storage, config, { requestId: "s4", publish: false, actor: creator, papers: more }, moreLookup)).results[0]).toMatchObject({ outcome: "queued" });
	});
});

it("tells Openscholar when a sent paper is approved or returned, until it answers, and says what each sent paper is", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(60, "Coaching teachers"), work(61, "Lesson study")]);
		const { results } = await addPapers(db, storage, config, { requestId: "t1", publish: false, actor: creator, papers: [{ openalexId: "W60" }, { openalexId: "W61" }] }, lookup);
		expect(results.map((result) => result.paper)).toEqual([
			{ title: "Coaching teachers", authors: "", year: 2020, openalexId: "W60", doi: "10.1000/w60" },
			{ title: "Lesson study", authors: "", year: 2020, openalexId: "W61", doi: "10.1000/w61" },
		]);
		// Each submission is told too, as waiting for review.
		expect(await db.select().from(submissionStatusDelivery)).toHaveLength(2);

		const [approve, ret] = await Promise.all(results.map(async (result) => (await db.select().from(itemReview).where(eq(itemReview.itemKey, result.itemKey!)))[0]!));
		await approveItemReview(db, storage, { reviewId: approve!.id, expectedRevision: approve!.revision }, { userId: "user_editor", role: "editor" }, config);
		await resolveItemReview(db, { reviewId: ret!.id, expectedRevision: ret!.revision, action: "returned", note: "Not about teachers" }, editor);

		const sent: Record<string, unknown>[] = [];
		let up = false;
		const openscholar = (async (_url: string | URL, init?: RequestInit) => {
			if (!up) return new Response("down", { status: 503 });
			const body = JSON.parse(String(init?.body));
			sent.push(body);
			return Response.json({ idempotencyKey: body.idempotencyKey, generation: body.generation });
		}) as typeof globalThis.fetch;
		await runSubmissionStatusCycle(db, config, undefined, openscholar);
		expect((await db.select().from(submissionStatusDelivery)).map((row) => row.attempts)).toEqual([1, 1]);

		up = true;
		await db.update(submissionStatusDelivery).set({ nextAttemptAt: new Date() });
		await runSubmissionStatusCycle(db, config, undefined, openscholar);
		expect(sent.map(({ itemKey, status, note, clerkUserId }) => ({ itemKey, status, note, clerkUserId })).sort((a, b) => String(a.status).localeCompare(String(b.status)))).toEqual([
			{ itemKey: results[0]!.itemKey, status: "published", note: null, clerkUserId: "user_creator" },
			{ itemKey: results[1]!.itemKey, status: "returned", note: "Not about teachers", clerkUserId: "user_creator" },
		]);
		expect((await db.select().from(submissionStatusDelivery)).every((row) => row.nextAttemptAt === null)).toBe(true);
		// What each paper is goes with it, so one sent from this site becomes the person's submission on Openscholar.
		expect(sent.map((body) => body.paper).sort((a, b) => String((a as { title: string }).title).localeCompare(String((b as { title: string }).title)))).toEqual([
			{ title: "Coaching teachers", authors: "", year: 2020, openalexId: "W60", doi: "10.1000/w60", requestId: expect.any(String) },
			{ title: "Lesson study", authors: "", year: 2020, openalexId: "W61", doi: "10.1000/w61", requestId: expect.any(String) },
		]);
	});
});

it("tells Openscholar an accepted paper is removed once the community unpublishes its record, and published again once it's back", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(70, "Reading partners")]);
		const { results } = await addPapers(db, storage, config, { requestId: "rm1", publish: true, actor: owner, papers: [{ openalexId: "W70" }] }, lookup);
		const key = results[0]!.itemKey!;
		const sent: Record<string, unknown>[] = [];
		const openscholar = (async (_url: string | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			sent.push(body);
			return Response.json({ idempotencyKey: body.idempotencyKey, generation: body.generation });
		}) as typeof globalThis.fetch;
		await runSubmissionStatusCycle(db, config, undefined, openscholar);
		expect(sent.at(-1)).toMatchObject({ itemKey: key, status: "published" });

		await unpublishNativeItem(db, key);
		await runSubmissionStatusCycle(db, config, undefined, openscholar);
		expect(sent.at(-1)).toMatchObject({ itemKey: key, status: "removed", clerkUserId: "user_owner", at: (await record(db, key))!.deletedAt!.toISOString() });

		// Restored by any path, it's live again.
		await db.update(item).set({ deleted: 0, deletedAt: null }).where(eq(item.key, key));
		await runSubmissionStatusCycle(db, config, undefined, openscholar);
		expect(sent.at(-1)).toMatchObject({ itemKey: key, status: "published" });
		expect(new Set(sent.map((body) => body.generation)).size).toBe(sent.length);
	});
});

it("sends a resubmitted paper as waiting again, from its new sender, and keeps an accepted paper published whatever later edits do", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(70), work(71)]);
		const reader = { userId: "user_reader", name: "Grace Otieno", role: "reader" } as const;
		const told: { itemKey: string; status: string; clerkUserId: string; requestId?: string }[] = [];
		const openscholar = (async (_url: string | URL, init?: RequestInit) => {
			const body = JSON.parse(String(init?.body));
			told.push({ itemKey: body.itemKey, status: body.status, clerkUserId: body.clerkUserId, requestId: body.paper?.requestId });
			return Response.json({ idempotencyKey: body.idempotencyKey, generation: body.generation });
		}) as typeof globalThis.fetch;
		const latest = async (itemKey: string) => (await db.select().from(itemReview).where(eq(itemReview.itemKey, itemKey)).orderBy(desc(itemReview.submittedAt)))[0]!;

		// Returned, then sent again by someone else before that word went out: the new submission is what's told.
		const returned = (await addPapers(db, storage, config, { requestId: "u1", publish: false, actor: creator, papers: [{ openalexId: "W70" }] }, lookup)).results[0]!.itemKey!;
		const first = await latest(returned);
		await resolveItemReview(db, { reviewId: first.id, expectedRevision: first.revision, action: "returned", note: "Not yet" }, editor);
		await addPapers(db, storage, config, { requestId: "u2", publish: false, actor: reader, papers: [{ openalexId: "W70" }] }, lookup);
		await runSubmissionStatusCycle(db, config, undefined, openscholar);
		expect(told.filter((entry) => entry.itemKey === returned)).toEqual([{ itemKey: returned, status: "queued", clerkUserId: "user_reader", requestId: "u2" }]);
		// Approved before that word goes out: published is told as theirs, whose version was accepted.
		const resent = await latest(returned);
		await approveItemReview(db, storage, { reviewId: resent.id, expectedRevision: resent.revision }, { userId: "user_editor", role: "editor" }, config);
		told.length = 0;
		await runSubmissionStatusCycle(db, config, undefined, openscholar);
		expect(told.filter((entry) => entry.itemKey === returned)).toEqual([{ itemKey: returned, status: "published", clerkUserId: "user_reader", requestId: "u2" }]);

		// Published, then an edit to it is returned: it stays published.
		const live = (await addPapers(db, storage, config, { requestId: "u3", publish: true, actor: owner, papers: [{ openalexId: "W71" }] }, lookup)).results[0]!.itemKey!;
		await db.insert(itemDraft).values({ itemKey: live, sourceConnectionKey: ADDED_PAPERS_SOURCE_CONNECTION_KEY, patch: { title: "Work 71, edited" } }).onConflictDoUpdate({ target: itemDraft.itemKey, set: { patch: { title: "Work 71, edited" } } });
		const edit = await submitItemReview(db, live, { userId: "user_creator", role: "creator" }, config);
		await resolveItemReview(db, { reviewId: edit.id, expectedRevision: edit.revision, action: "returned", note: "Keep the title" }, editor);
		told.length = 0;
		await runSubmissionStatusCycle(db, config, undefined, openscholar);
		expect(told.filter((entry) => entry.itemKey === live)).toEqual([{ itemKey: live, status: "published", clerkUserId: "user_owner", requestId: "u3" }]);
	});
});

it("leaves withdrawing a paper to the person who sent it, so the team declines it with a reason instead", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(82)]);
		const key = (await addPapers(db, storage, config, { requestId: "w1", publish: false, actor: creator, papers: [{ openalexId: "W82" }] }, lookup)).results[0]!.itemKey!;
		const [review] = await db.select().from(itemReview).where(eq(itemReview.itemKey, key));
		await expect(resolveItemReview(db, { reviewId: review!.id, expectedRevision: review!.revision, action: "withdrawn" }, editor)).rejects.toThrow(/Decline it with a reason/);
		await resolveItemReview(db, { reviewId: review!.id, expectedRevision: review!.revision, action: "returned", note: "Outside this community's focus" }, editor);
	});
});

it("refuses to withdraw a paper whose request stopped before it reached the review queue", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const { lookup } = services([work(80)]);
		const key = (await addPapers(db, storage, config, { requestId: "x1", publish: false, actor: creator, papers: [{ openalexId: "W80" }] }, lookup)).results[0]!.itemKey!;
		// As a request that stopped after making the record and before submitting it leaves the paper.
		await db.delete(itemReview).where(eq(itemReview.itemKey, key));
		await expect(removeAddedPaper(db, key, { userId: creator.userId, role: "creator" })).rejects.toThrow(/isn't in the review queue yet/);
	});
});

it("leaves a paper found by its DOI on its DOI when another source brought its work in first, so the work has one record", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const doi = "10.1000/late-work";
		const missing = services([], { [doi]: { itemType: "journalArticle", title: "Late work", DOI: doi } });
		const key = (await addPapers(db, new MemoryFileStorage(), config, { requestId: "y1", publish: true, actor: owner, papers: [{ doi }] }, missing.lookup)).results[0]!.itemKey!;
		await searchFinds(db, [work(90, "Late work", doi)]);
		await sync(db, services([work(90, "Late work", doi)]).fetch);
		const holders = new Set((await db.select({ itemKey: itemSourceLink.itemKey }).from(itemSourceLink).where(eq(itemSourceLink.sourceRecordKey, "W90"))).map((row) => row.itemKey));
		expect(holders.size).toBe(1);
		// Linked to its work only if it's the record the search holds too.
		const [paper] = await db.select().from(addedPaper).where(eq(addedPaper.itemKey, key));
		expect(paper!.openalexId === null || holders.has(key)).toBe(true);
	});
});

it("adds an Openscholar Report from Openscholar alone, and its sync follows a correction and a withdrawal without OpenAlex taking it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const storage = new MemoryFileStorage();
		const doi = "10.53832/openscholar-r.r100001";
		const live = (title: string, version: string): OpenscholarReport => ({
			state: "live", key: "R100001", doi, version, title, subtitle: "", type: "report", language: "en", date: "2026-11-10", licence: "CC BY 4.0",
			abstract: "We measure maize yields on 640 plots.", authors: [{ name: "Chikondi Banda", orcid: null, affiliations: [{ id: "https://openalex.org/I4210087849", name: "University of Rwanda", country: "RW", ror: "https://ror.org/00286hs46" }] }], keywords: ["maize"], topics: [{ id: "T10017", name: "Soil and water conservation", score: 0.82 }], series: "Openscholar Reports",
			pageUrl: "https://openscholar.test/papers/R100001", pdfUrl: "https://openscholar.test/papers/R100001/report.pdf",
		});
		const reports = new Map<string, OpenscholarReport>([[doi, live("Shade trees and maize yields", "2026-11-10T08:00:00.000Z")]]);
		// OpenAlex has a work under the same DOI, and the DOI lookup a record: neither is the one taken.
		const world = services([work(99, "OpenAlex's copy", doi)], { [doi]: { itemType: "journalArticle", title: "The lookup's copy", DOI: doi } }, reports);
		const { results } = await addPapers(db, storage, config, { requestId: "r-report", publish: true, actor: owner, papers: [{ doi }] }, world.lookup);
		expect(results).toMatchObject([{ at: 0, outcome: "added", itemKey: expect.any(String), foundBy: "doi" }]);
		const key = results[0]!.itemKey!;
		expect(await record(db, key)).toMatchObject({ title: "Shade trees and maize yields", url: "https://openscholar.test/papers/R100001", deleted: 0 });

		// Its sync keeps it Openscholar's: OpenAlex is never asked about its DOI, and its PDF is downloaded from
		// Openscholar once and hosted here, cover and all.
		vi.mocked(transport).mockReset().mockImplementation(async () => new TransportResponse(await createPdf("Shade trees and maize yields")));
		const pdfs = new MemoryFileStorage();
		const downloads = () => vi.mocked(transport).mock.calls.map(([url]) => String(url));
		const hosted = async () => (await db.select({ url: item.url, deleted: item.deleted }).from(item).where(eq(item.parentItem, key)));
		expect((await sync(db, world.fetch, pdfs)).unresolved).toBe(0);
		// Its author's affiliation is the creator's institution, placed in its country with its OpenAlex ID, and its topic is
		// the record's, as an OpenAlex work's are.
		expect(await db.select({ creators: item.creators, topics: item.topics }).from(item).where(eq(item.key, key))).toEqual([{ creators: [{ creatorType: "author", name: "Chikondi Banda", institutions: [{ display_name: "University of Rwanda" }] }], topics: ["T10017"] }]);
		// Placed where OpenAlex says it is, for the map, as an OpenAlex work's institutions are.
		expect(await db.select({ countryCode: institutionCountry.countryCode, openalexId: institutionCountry.openalexId, city: institutionCountry.city, latitude: institutionCountry.latitude }).from(institutionCountry)).toEqual([{ countryCode: "RW", openalexId: "I4210087849", city: "Kigali", latitude: -1.95 }]);
		expect(world.askedOfOpenAlex.filter((filter) => filter.includes(doi))).toEqual([]);
		expect((await db.select().from(addedPaper).where(eq(addedPaper.itemKey, key)))[0]?.openalexId).toBeNull();
		expect(await hosted()).toEqual([{ url: expect.stringMatching(/^http:\/\/storage\.local\/public\/.+\/document\.pdf$/u), deleted: 0 }]);
		expect([...pdfs.publicFiles.keys()].map((path) => path.split("/").at(-1)).sort()).toEqual(["cover.jpg", "document.pdf"]);
		expect(downloads()).toEqual(["https://openscholar.test/papers/R100001/report.pdf"]);

		// A correction changes the record and keeps the PDF it holds, without downloading it again.
		reports.set(doi, live("Shade trees and maize yields, corrected", "2026-11-11T09:00:00.000Z"));
		await sync(db, world.fetch, pdfs);
		expect(await record(db, key)).toMatchObject({ title: "Shade trees and maize yields, corrected", deleted: 0 });
		expect(downloads()).toHaveLength(1);
		expect(pdfs.publicFiles.size).toBe(2);

		// Withdrawn on Openscholar, its PDF is deleted here too: the file is public.
		reports.set(doi, { state: "withdrawn", key: "R100001", doi, version: "2026-11-12T09:00:00.000Z" });
		await sync(db, world.fetch, pdfs);
		expect((await record(db, key))?.deleted).toBe(1);
		expect(await linked(db, key)).toBe(true);
		expect(await db.select().from(itemFilePublication)).toEqual([]);
		expect(pdfs.publicFiles.size).toBe(0);

		// Reinstated, it is back with its PDF, downloaded again.
		reports.set(doi, live("Shade trees and maize yields, corrected", "2026-11-13T09:00:00.000Z"));
		await sync(db, world.fetch, pdfs);
		expect(await record(db, key)).toMatchObject({ deleted: 0 });
		expect(await hosted()).toEqual([{ url: expect.stringMatching(/^http:\/\/storage\.local\/public\//u), deleted: 0 }]);
		expect(pdfs.publicFiles.size).toBe(2);

		// Taken off Added papers it leaves, PDF and all; added again by its DOI, it comes back as a new record with a PDF
		// of its own.
		expect(await removeAddedPaper(db, key, { userId: owner.userId, role: "owner" })).toBe("removed");
		expect(await record(db, key)).toMatchObject({ deleted: 1 });
		const readded = await addPapers(db, storage, config, { requestId: "r-report-again", publish: true, actor: owner, papers: [{ doi }] }, world.lookup);
		expect(readded.results).toMatchObject([{ at: 0, outcome: "added" }]);
		const newKey = readded.results[0]!.itemKey!;
		const pdfOf = (parent: string) => db.select({ url: item.url, deleted: item.deleted }).from(item).where(eq(item.parentItem, parent));
		await sync(db, world.fetch, pdfs);
		expect(await pdfOf(newKey)).toEqual([{ url: expect.stringMatching(/^http:\/\/storage\.local\/public\/.+\/document\.pdf$/u), deleted: 0 }]);
		// The old record's copy is gone from storage: only the new one's PDF and cover are left.
		expect(pdfs.publicFiles.size).toBe(2);

		// While a connected collection brings it too, taking it off Added papers leaves it public, PDF and all.
		await db.insert(sourceConnection).values({ key: "openscholar-c1", provider: "openscholar", scopeKind: "collection", externalScopeKey: "c1", config: {} });
		await db.insert(itemSourceLink).values({ itemKey: newKey, sourceConnectionKey: "openscholar-c1", sourceRecordKey: `doi:${doi}` });
		await db.update(outbox).set({ processedAt: new Date() }).where(eq(outbox.entityKey, newKey));
		expect(await removeAddedPaper(db, newKey, { userId: owner.userId, role: "owner" })).toBe("removed");
		expect(await record(db, newKey)).toMatchObject({ deleted: 0 });
		// It is searched again, without Added papers among its sources.
		expect(await db.select({ operation: outbox.operation }).from(outbox).where(and(eq(outbox.entityKey, newKey), isNull(outbox.processedAt)))).toEqual([{ operation: "upsert" }]);
		expect(await pdfOf(newKey)).toEqual([{ url: expect.stringMatching(/^http:\/\/storage\.local\/public\//u), deleted: 0 }]);

		// Given by its OpenAlex work alone, a report is still taken from Openscholar: its DOI is learned from the work.
		const other = "10.53832/openscholar-r.r100002";
		const second = services([work(98, "OpenAlex's copy of another report", other)], {}, new Map([[other, { ...live("Rain gauges and bean yields", "2026-11-10T08:00:00.000Z"), key: "R100002", doi: other, pageUrl: "https://openscholar.test/papers/R100002", pdfUrl: null }]]));
		const byWork = await addPapers(db, storage, config, { requestId: "r-report-work", publish: true, actor: owner, papers: [{ openalexId: "W98" }] }, second.lookup);
		expect(byWork.results).toMatchObject([{ at: 0, outcome: "added", foundBy: "doi" }]);
		expect(await record(db, byWork.results[0]!.itemKey!)).toMatchObject({ title: "Rain gauges and bean yields", url: "https://openscholar.test/papers/R100002" });
		// And one withdrawn on Openscholar isn't added through OpenAlex's copy of it.
		const gone = "10.53832/openscholar-r.r100003";
		const third = services([work(97, "OpenAlex's copy of a withdrawn report", gone)], {}, new Map([[gone, { state: "withdrawn", key: "R100003", doi: gone, version: "2026-11-12T09:00:00.000Z" }]]));
		expect((await addPapers(db, storage, config, { requestId: "r-report-gone", publish: true, actor: owner, papers: [{ openalexId: "W97" }] }, third.lookup)).results).toMatchObject([{ at: 0, outcome: "not_found", message: "This report was withdrawn on Openscholar." }]);

		// A withdrawn report isn't added.
		const again = await addPapers(db, storage, config, { requestId: "r-report-2", publish: true, actor: owner, papers: [{ doi: "10.53832/openscholar-r.r100009" }] }, services([], {}, new Map([["10.53832/openscholar-r.r100009", { state: "withdrawn", key: "R100009", doi: "10.53832/openscholar-r.r100009", version: "2026-11-12T09:00:00.000Z" }]])).lookup);
		expect(again.results).toMatchObject([{ at: 0, outcome: "not_found", message: "This report was withdrawn on Openscholar." }]);
	});
});

/** A report as Openscholar answers for it while it is live. */
const liveReport = (doi: string, key: string): OpenscholarReport => ({
	state: "live", key, doi, version: "2026-11-10T08:00:00.000Z", title: "Mulch and school gardens", subtitle: "", type: "report", language: "en", date: "2026-11-10",
	licence: "CC BY 4.0", abstract: "We measure infiltration.", authors: [{ name: "Chikondi Banda", orcid: null, affiliations: [] }], keywords: ["mulch"], topics: [], series: "Openscholar Reports",
	pageUrl: `https://openscholar.test/papers/${key}`, pdfUrl: `https://openscholar.test/papers/${key}/report.pdf`,
});

/** A connected collection's source, writing a report as its own sync does. */
async function collectionSource(db: Database, storage: MemoryFileStorage) {
	await db.insert(sourceConnection).values({ key: "openscholar-c1", provider: "openscholar", scopeKind: "collection", externalScopeKey: "c1", config: {} });
	const context = async () => ({ database: db, sourceConnection: (await db.select().from(sourceConnection).where(eq(sourceConnection.key, "openscholar-c1")))[0]!, credentialResolver: async () => "test-key", heartbeat: async () => {} });
	const options = { attachmentProcessor: createOpenAlexAttachmentProcessor({ database: db, storage, maxPdfBytes: 20 * 1024 * 1024 }) };
	return {
		hold: async (dois: string[], reports: ReadonlyMap<string, OpenscholarReport>) => syncDoiRecords(await context(), { dois, works: new Map(), reports }, options),
		remove: () => db.update(sourceConnection).set({ status: "removed" }).where(eq(sourceConnection.key, "openscholar-c1")),
	};
}

const publicWithDoi = async (db: Database, doi: string) => (await db.select({ key: item.key }).from(item).where(and(eq(item.DOI, doi), eq(item.deleted, 0)))).map((row) => row.key);

it("takes down a report no source follows any more once Openscholar withdraws it, stored PDF and all", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		vi.mocked(transport).mockReset().mockImplementation(async () => new TransportResponse(await createPdf("Mulch and school gardens")));
		const storage = new MemoryFileStorage();
		const doi = "10.53832/openscholar-r.r100035";
		const reports = new Map([[doi, liveReport(doi, "R100035")]]);
		const world = services([], {}, reports);
		const collection = await collectionSource(db, storage);
		await collection.hold([doi], reports);
		const [key] = await publicWithDoi(db, doi);
		expect(storage.publicFiles.size).toBe(2);
		// The team wrote a note under it, which the record's unpublish would otherwise refuse.
		const note = await createNativeItemDraft(db, { itemType: "Note", note: "Read with the 2025 baseline.", parentItem: key! });
		await publishItemDraft(db, note.itemKey);

		// Its collection is removed, which keeps the records it brought; then Openscholar withdraws the report.
		await collection.remove();
		reports.set(doi, { state: "withdrawn", key: "R100035", doi, version: "2026-11-12T09:00:00.000Z" });
		await sync(db, world.fetch, storage);
		expect(await record(db, key!)).toMatchObject({ deleted: 1 });
		expect(await record(db, note.itemKey)).toMatchObject({ deleted: 1 });
		expect(storage.publicFiles.size).toBe(0);
		// Openscholar's withdrawal, not the team's: nothing marks the record deleted for good, so a source that takes the
		// report back after a reinstatement brings it back.
		expect(await db.select({ key: itemFieldOverride.itemKey }).from(itemFieldOverride).where(and(eq(itemFieldOverride.field, "deleted"), eq(itemFieldOverride.itemKey, key!)))).toEqual([]);
	});
});

it("keeps one record for a report a collection takes back after Added papers added it again", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		vi.mocked(transport).mockReset().mockImplementation(async () => new TransportResponse(await createPdf("Mulch and school gardens")));
		const storage = new MemoryFileStorage();
		const doi = "10.53832/openscholar-r.r100025";
		const reports = new Map([[doi, liveReport(doi, "R100025")]]);
		const world = services([], {}, reports);
		const collection = await collectionSource(db, storage);
		await collection.hold([doi], reports);
		// The collection lets it go, and Added papers adds it again: a new record.
		await collection.hold([], new Map());
		expect(await publicWithDoi(db, doi)).toEqual([]);
		const { results } = await addPapers(db, storage, config, { requestId: "r-back", publish: true, actor: owner, papers: [{ doi }] }, world.lookup);
		await sync(db, world.fetch, storage);
		// Then the collection has it again: it joins that record rather than bring back its own, and the record is
		// searched again with the collection among its sources.
		await db.update(outbox).set({ processedAt: new Date() });
		await collection.hold([doi], reports);
		expect(await db.select({ key: outbox.entityKey }).from(outbox).where(and(eq(outbox.entityKey, results[0]!.itemKey!), isNull(outbox.processedAt)))).toEqual([{ key: results[0]!.itemKey }]);
		expect(await publicWithDoi(db, doi)).toEqual([results[0]!.itemKey]);
		expect((await db.select({ source: itemSourceLink.sourceConnectionKey }).from(itemSourceLink).where(eq(itemSourceLink.itemKey, results[0]!.itemKey!))).map((row) => row.source).sort()).toEqual(["added-papers", "openscholar-c1"]);
	});
});

it("imports an Openscholar Report by its DOI from Openscholar's own details, and never one withdrawn there", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const live = "10.53832/openscholar-r.r100001";
		const withdrawn = "10.53832/openscholar-r.r100009";
		const reports = new Map<string, OpenscholarReport>([
			[live, {
				state: "live", key: "R100001", doi: live, version: "2026-11-10T08:00:00.000Z", title: "Shade trees and maize yields", subtitle: "Evidence from three seasons", type: "report", language: "en", date: "2026-11-10",
				licence: "CC BY 4.0", abstract: "We measure maize yields on 640 plots.", authors: [{ name: "Chikondi Banda", orcid: null, affiliations: [] }], keywords: ["maize"], topics: [], series: "Openscholar Reports",
				pageUrl: "https://openscholar.test/papers/R100001", pdfUrl: "https://openscholar.test/papers/R100001/report.pdf",
			}],
			[withdrawn, { state: "withdrawn", key: "R100009", doi: withdrawn, version: "2026-11-12T09:00:00.000Z" }],
		]);
		const asked: string[][] = [];
		// The translation server isn't there: a report's record needs no DOI lookup.
		const preview = await previewImportRecords(db, { action: "preview", dois: [`https://doi.org/${live}`, withdrawn], files: [] }, "http://127.0.0.1:9", {
			papersAtLinks: async () => [],
			reportsByDoi: async (dois) => {
				asked.push([...dois]);
				return new Map(dois.flatMap((doi) => (reports.has(doi) ? [[doi, reports.get(doi)!] as const] : [])));
			},
		});
		// One request for all of them.
		expect(asked).toEqual([[live, withdrawn]]);
		expect(preview.records).toMatchObject([
			{ state: "ready", method: "doi", source: live, title: "Shade trees and maize yields: Evidence from three seasons", year: 2026, creators: ["Chikondi Banda"], payload: { DOI: live, url: "https://openscholar.test/papers/R100001" } },
			{ state: "unresolved", source: withdrawn, message: "This report was withdrawn on Openscholar." },
		]);
	});
});
