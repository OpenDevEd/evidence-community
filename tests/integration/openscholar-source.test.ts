import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

import { and, eq, isNull } from "drizzle-orm";
import { itemSourceLink, sourceConnection, sourceRecordIssue } from "@opendeved/evidence-library-core";
import { item } from "@/db/schema/tables/item";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { COLLECTION_ITEMS_PATH } from "@/lib/source-ingestion/openscholar/client";
import { syncOpenScholarCollection } from "@/lib/source-ingestion/openscholar/sync";
import { classifySourceError } from "@/lib/source-ingestion/source-status";
import type { Database } from "@/db/database-schema";
import type { SourceItemUpsert } from "@/lib/source-ingestion/batch-schema";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const service = {
	convexSiteUrl: "https://openscholar.test",
	libraryId: "library-1",
	libraryUrl: "https://openscholar.test/evidence-libraries/library-1",
	accountUrl: "https://accounts.openscholar.test/user",
	machineCredential: "m".repeat(47),
	oauth: { issuer: "https://clerk.openscholar.test", clientId: "client", clientSecret: "client-secret-value" },
} as Parameters<typeof syncOpenScholarCollection>[1]["service"];

const work = (id: number) => ({
	id: `https://openalex.org/W${id}`,
	type: "article",
	title: `Work ${id}`,
	updated_date: "2026-09-24T10:00:00Z",
});

/** OpenScholar answers with the collection it holds now; OpenAlex answers id filters. */
function services(collection: { current: { version: string; ids: number[] } | "owner_left" }) {
	const openAlexRequests: string[][] = [];
	const collectionRequests: { knownVersion: string | null }[] = [];
	const request = (async (input: string | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		if (url.pathname === COLLECTION_ITEMS_PATH) {
			const body = JSON.parse(String(init?.body)) as { knownVersion: string | null };
			collectionRequests.push({ knownVersion: body.knownVersion });
			const current = collection.current;
			if (current === "owner_left") return Response.json({ error: "owner_left" }, { status: 403 });
			const base = { contractVersion: 1, version: current.version, name: "Reading list" };
			if (body.knownVersion === current.version) return Response.json({ ...base, unchanged: true });
			return Response.json({
				...base,
				items: current.ids.map((id) => ({ itemId: `item-${id}`, openalexId: `W${id}`, doi: null })),
				nextCursor: null,
			});
		}
		const requested = url.searchParams.get("filter")!.match(/^ids\.openalex:([^,]+)/u)![1]!.split("|");
		openAlexRequests.push(requested);
		// Like OpenAlex, a request without a cursor gets no `next_cursor`.
		const meta = { count: requested.length, ...(url.searchParams.has("cursor") ? { next_cursor: null } : {}) };
		return Response.json({ meta, results: requested.map((id) => work(Number(id.slice(1)))) });
	}) as typeof fetch;
	return { request, openAlexRequests, collectionRequests };
}

async function connection(db: Database, key: string) {
	const [row] = await db.select().from(sourceConnection).where(eq(sourceConnection.key, key));
	return row!;
}

const context = async (db: Database, key: string) => ({
	database: db,
	sourceConnection: await connection(db, key),
	credentialResolver: async () => "test-key",
	heartbeat: async () => {},
});

const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

async function activeKeys(db: Database, sourceConnectionKey: string) {
	const rows = await db
		.select({ record: itemSourceLink.sourceRecordKey, itemKey: itemSourceLink.itemKey })
		.from(itemSourceLink)
		.where(and(eq(itemSourceLink.sourceConnectionKey, sourceConnectionKey), eq(itemSourceLink.remoteDeleted, false)));
	return new Map(rows.map((row) => [row.record, row.itemKey]));
}

async function seed(db: Database) {
	await db.insert(sourceConnection).values([
		{
			key: "oa-search",
			provider: "openalex",
			scopeKind: "query",
			config: {
				name: "AI in education",
				searchUrl: "/results/saved-search-1",
				approvedQuery: { version: "v1", approvedAt: "2026-09-24T10:00:00Z", query: { search: "AI" } },
				downloadPdfs: false,
			},
		},
		{
			key: "openscholar-c1",
			provider: "openscholar",
			scopeKind: "collection",
			externalScopeKey: "c1",
			config: { name: "Reading list", apiKeyMode: "platform", downloadPdfs: false },
		},
	]);
	await syncOpenAlexSource(await context(db, "oa-search"), {
		fetch: async () => Response.json({ meta: { count: 3, next_cursor: null }, results: [work(1), work(2), work(3)] }),
	});
}

it("imports a collection a hundred ids per request, shares works with an OpenAlex search, and follows its changes", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seed(db);
		const collection = { current: { version: "v1", ids: range(2, 251) } as { version: string; ids: number[] } | "owner_left" };
		const { request, openAlexRequests, collectionRequests } = services(collection);

		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request });
		// The first page shows the size, then the parts are read at once; the first part is read again.
		expect(openAlexRequests.length).toBeLessThanOrEqual(Math.ceil(250 / 100) + 1);
		expect(openAlexRequests.every((ids) => ids.length <= 100)).toBe(true);
		const search = await activeKeys(db, "oa-search");
		const followed = await activeKeys(db, "openscholar-c1");
		expect(followed.size).toBe(250);
		// A work in both sources is one record.
		expect(followed.get("W2")).toBe(search.get("W2"));
		expect(followed.get("W3")).toBe(search.get("W3"));
		expect(await db.select({ key: item.key }).from(item).where(isNull(item.parentItem))).toHaveLength(251);
		expect((await connection(db, "openscholar-c1")).displayName).toBe("Reading list");

		// An unchanged collection costs OpenScholar one request and OpenAlex none.
		openAlexRequests.length = 0;
		collectionRequests.length = 0;
		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request });
		expect(collectionRequests).toEqual([{ knownVersion: "v1" }]);
		expect(openAlexRequests).toEqual([]);

		// Items taken out leave the source; a work another source still holds stays public.
		collection.current = { version: "v2", ids: range(2, 250).filter((id) => id !== 3) };
		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request });
		const after = await activeKeys(db, "openscholar-c1");
		expect(after.has("W3")).toBe(false);
		expect(after.has("W251")).toBe(false);
		const [kept] = await db.select({ deleted: item.deleted }).from(item).where(eq(item.key, search.get("W3")!));
		const [withdrawn] = await db.select({ deleted: item.deleted }).from(item).where(eq(item.key, followed.get("W251")!));
		expect(kept?.deleted).toBe(0);
		expect(withdrawn?.deleted).toBe(1);

		// An emptied collection withdraws everything it held, without asking OpenAlex.
		openAlexRequests.length = 0;
		collection.current = { version: "v3", ids: [] };
		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request });
		expect(openAlexRequests).toEqual([]);
		expect((await activeKeys(db, "openscholar-c1")).size).toBe(0);
	});
}, 120_000);

it("adds a collection's PDFs through the shared PDF stage once its records are in", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await db.insert(sourceConnection).values({
			key: "openscholar-c1",
			provider: "openscholar",
			scopeKind: "collection",
			externalScopeKey: "c1",
			config: { name: "Reading list", apiKeyMode: "platform", downloadPdfs: true },
		});
		const ids = range(1, 150);
		const collection = { current: { version: "v1", ids } as { version: string; ids: number[] } | "owner_left" };
		const { request, openAlexRequests } = services(collection);
		const withPdfs = (async (input: string | URL, init?: RequestInit) => {
			const response = await request(input, init);
			if (new URL(String(input)).pathname === COLLECTION_ITEMS_PATH) return response;
			const page = (await response.json()) as { meta: unknown; results: ReturnType<typeof work>[] };
			return Response.json({
				...page,
				results: page.results.map((result) => ({
					...result,
					best_oa_location: { is_oa: true, pdf_url: `https://example.org/${result.id.split("/").pop()}.pdf` },
				})),
			});
		}) as typeof fetch;
		const downloaded: string[] = [];
		const processor = Object.assign(
			async (record: SourceItemUpsert) => {
				downloaded.push(record.sourceRecordKey);
				return record;
			},
			{ reuse: async (record: SourceItemUpsert) => record, flushCleanup: async () => {} },
		);

		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: withPdfs, attachmentProcessor: processor });

		expect(downloaded.sort()).toEqual(ids.map((id) => `W${id}:pdf`).sort());
		expect((await connection(db, "openscholar-c1")).syncCursor).toMatchObject({ stage: "pdfs", pdfs: { done: 150, missed: 0 } });
		// Records in parallel parts, then the PDF stage reads the collection again a hundred at a time.
		expect(openAlexRequests.length).toBeLessThanOrEqual(Math.ceil(150 / 100) + 1 + Math.ceil(150 / 100));
	});
}, 120_000);

it("withdraws a collection's works when the person who added it leaves, and imports it again if access returns", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seed(db);
		const collection = { current: { version: "v1", ids: [2, 4] } as { version: string; ids: number[] } | "owner_left" };
		const { request } = services(collection);
		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request });
		const followed = await activeKeys(db, "openscholar-c1");
		const search = await activeKeys(db, "oa-search");

		collection.current = "owner_left";
		const failure = await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request }).catch((error: unknown) => error);
		expect(classifySourceError(failure)).toBe("owner_left");
		expect((await activeKeys(db, "openscholar-c1")).size).toBe(0);
		const [shared] = await db.select({ deleted: item.deleted }).from(item).where(eq(item.key, search.get("W2")!));
		const [own] = await db.select({ deleted: item.deleted }).from(item).where(eq(item.key, followed.get("W4")!));
		expect(shared?.deleted).toBe(0);
		expect(own?.deleted).toBe(1);

		// The same version comes back, yet the source was forgotten, so it imports in full.
		collection.current = { version: "v1", ids: [2, 4] };
		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request });
		expect([...(await activeKeys(db, "openscholar-c1")).keys()].sort()).toEqual(["W2", "W4"]);
		const [back] = await db.select({ deleted: item.deleted }).from(item).where(eq(item.key, followed.get("W4")!));
		expect(back?.deleted).toBe(0);
	});
}, 120_000);

it("finds a collection paper that has only a DOI on OpenAlex by it, and lists the ones OpenAlex doesn't have until it does", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seed(db);
		const onOpenAlex = new Map([["10.1000/w5", 5]]);
		let version = "v1";
		const items = [
			{ itemId: "item-2", openalexId: "W2", doi: null },
			{ itemId: "item-5", openalexId: null, doi: "https://doi.org/10.1000/W5" },
			{ itemId: "item-6", openalexId: null, doi: "10.1000/w6" },
		];
		const request = (async (input: string | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			if (url.pathname === COLLECTION_ITEMS_PATH) {
				const body = JSON.parse(String(init?.body)) as { knownVersion: string | null };
				const base = { contractVersion: 1, version, name: "Reading list" };
				return Response.json(body.knownVersion === version ? { ...base, unchanged: true } : { ...base, items, nextCursor: null });
			}
			const filter = url.searchParams.get("filter")!;
			const meta = (count: number) => ({ count, ...(url.searchParams.has("cursor") ? { next_cursor: null } : {}) });
			const dois = filter.match(/^doi:([^,]+)/u)?.[1]?.split("|");
			if (dois) {
				const results = dois.flatMap((doi) => (onOpenAlex.has(doi) ? [{ ...work(onOpenAlex.get(doi)!), doi: `https://doi.org/${doi}` }] : []));
				return Response.json({ meta: meta(results.length), results });
			}
			const ids = filter.match(/^ids\.openalex:([^,]+)/u)![1]!.split("|");
			return Response.json({ meta: meta(ids.length), results: ids.map((id) => work(Number(id.slice(1)))) });
		}) as typeof fetch;
		const issues = async () => (await db.select().from(sourceRecordIssue).where(eq(sourceRecordIssue.sourceConnectionKey, "openscholar-c1"))).map((row) => [row.sourceRecordKey, row.code]);

		const asked: (string | null)[] = [];
		const counting = (async (input: string | URL, init?: RequestInit) => {
			if (new URL(String(input)).pathname === COLLECTION_ITEMS_PATH) asked.push((JSON.parse(String(init?.body)) as { knownVersion: string | null }).knownVersion);
			return request(input, init);
		}) as typeof fetch;
		const result = await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: counting });
		expect([...(await activeKeys(db, "openscholar-c1")).keys()].sort()).toEqual(["W2", "W5"]);
		// The scan is saved under the works the DOIs resolved to, so a resumed scan never reads another list; Openscholar
		// is asked about its own version alone.
		const [saved] = await db.select({ cursor: sourceConnection.syncCursor }).from(sourceConnection).where(eq(sourceConnection.key, "openscholar-c1"));
		expect((saved!.cursor as { queryVersion: string }).queryVersion).toMatch(/^v1~[0-9a-f]{16}$/u);
		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: counting });
		expect(asked).toEqual([null, "v1"]);
		expect(await issues()).toEqual([["doi:10.1000/w6", "doi_not_on_openalex"]]);
		expect(result.unresolved).toBe(1);

		// Once OpenAlex has it, the next sync brings it in and takes it off the list.
		onOpenAlex.set("10.1000/w6", 6);
		version = "v2";
		await syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request });
		expect([...(await activeKeys(db, "openscholar-c1")).keys()].sort()).toEqual(["W2", "W5", "W6"]);
		expect(await issues()).toEqual([]);
	});
}, 120_000);

it("makes a collection paper OpenAlex doesn't have from its DOI, makes it its work's once OpenAlex has it, and withdraws one that leaves", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await seed(db);
		const onOpenAlex = new Map<string, number>();
		let version = "v1";
		let gone = false;
		let items = [
			{ itemId: "item-2", openalexId: "W2", doi: null },
			{ itemId: "item-6", openalexId: null, doi: "10.1000/w6" },
			{ itemId: "item-7", openalexId: null, doi: "10.1000/w7" },
			{ itemId: "item-8", openalexId: null, doi: "10.1000/w8" },
			{ itemId: "item-9", openalexId: null as string | null, doi: "10.1000/w9" },
		];
		const request = (async (input: string | URL, init?: RequestInit) => {
			const url = new URL(String(input));
			if (url.pathname === COLLECTION_ITEMS_PATH) {
				if (gone) return Response.json({ error: "owner_left" }, { status: 403 });
				const body = JSON.parse(String(init?.body)) as { knownVersion: string | null };
				const base = { contractVersion: 1, version, name: "Reading list" };
				return Response.json(body.knownVersion === version ? { ...base, unchanged: true } : { ...base, items, nextCursor: null });
			}
			const filter = url.searchParams.get("filter")!;
			const meta = (count: number) => ({ count, ...(url.searchParams.has("cursor") ? { next_cursor: null } : {}) });
			const dois = filter.match(/^doi:([^,]+)/u)?.[1]?.split("|");
			if (dois) {
				const results = dois.flatMap((doi) => (onOpenAlex.has(doi) ? [{ ...work(onOpenAlex.get(doi)!), doi: `https://doi.org/${doi}` }] : []));
				return Response.json({ meta: meta(results.length), results });
			}
			const ids = filter.match(/^ids\.openalex:([^,]+)/u)![1]!.split("|");
			return Response.json({ meta: meta(ids.length), results: ids.map((id) => work(Number(id.slice(1)))) });
		}) as typeof fetch;
		// The DOI lookup finds w6, w8 and w9, with the empty collections its payloads always carry; w7 is nowhere yet.
		const recordByDoi = async (doi: string) => (doi === "10.1000/w7" ? null : { itemType: "journalArticle", title: `Found by ${doi}`, DOI: doi, collections: [] });
		const sync = async () => syncOpenScholarCollection(await context(db, "openscholar-c1"), { service, fetch: request, recordByDoi });
		const issues = async () => (await db.select().from(sourceRecordIssue).where(eq(sourceRecordIssue.sourceConnectionKey, "openscholar-c1"))).map((row) => row.sourceRecordKey);

		const first = await sync();
		const made = await activeKeys(db, "openscholar-c1");
		expect([...made.keys()].sort()).toEqual(["W2", "doi:10.1000/w6", "doi:10.1000/w8", "doi:10.1000/w9"]);
		expect((await db.select({ title: item.title }).from(item).where(eq(item.key, made.get("doi:10.1000/w6")!)))[0]?.title).toBe("Found by 10.1000/w6");
		expect(await issues()).toEqual(["doi:10.1000/w7"]);
		expect(first.unresolved).toBe(1);

		// OpenAlex has w6 now, and the collection names w9's work itself: each same record becomes its work's. w8 left the
		// collection: it's withdrawn.
		onOpenAlex.set("10.1000/w6", 6);
		items = items.filter((entry) => entry.itemId !== "item-8").map((entry) => (entry.itemId === "item-9" ? { ...entry, openalexId: "W9" } : entry));
		version = "v2";
		await sync();
		const after = await activeKeys(db, "openscholar-c1");
		expect([...after.keys()].sort()).toEqual(["W2", "W6", "W9"]);
		expect(after.get("W6")).toBe(made.get("doi:10.1000/w6"));
		expect(after.get("W9")).toBe(made.get("doi:10.1000/w9"));
		expect(await issues()).toEqual(["doi:10.1000/w7"]);

		// A DOI record that's still one, and the works, all go when the library loses the collection.
		onOpenAlex.delete("10.1000/w6");
		items = [...items, { itemId: "item-8", openalexId: null, doi: "10.1000/w8" }];
		version = "v3";
		await sync();
		expect([...(await activeKeys(db, "openscholar-c1")).keys()]).toContain("doi:10.1000/w8");
		gone = true;
		await expect(sync()).rejects.toThrow(/owner_left|left|access/iu);
		expect([...(await activeKeys(db, "openscholar-c1")).keys()]).toEqual([]);
	});
}, 120_000);
