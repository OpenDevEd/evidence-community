import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { outbox } from "@opendeved/evidence-library-core";
import { publicationTarget } from "@/db/schema/publication";
import { itemSourceLink, sourceConnection, sourceSnapshot } from "@/db/schema/source";
import type { Database } from "@/db/database-schema";
import { getPublicItemLinks } from "@/lib/links/item-links";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { createOpenAlexSourceAdapter } from "@/lib/source-ingestion/openalex/adapter";
import { SourceAdapterRegistry } from "@/lib/source-ingestion/adapter";
import { runActiveSourceConnections, runSourceConnection } from "@/lib/source-ingestion/orchestrator";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const settings = (search: string) => ({
	name: "AI in education",
	searchUrl: "/results/saved-search-1",
	approvedQuery: {
		version: "v1",
		approvedAt: "2026-09-24T10:00:00Z",
		query: { search },
	},
	downloadPdfs: false,
});

const work = (id: number, referencedWorks: number[] = []) => ({
	id: `https://openalex.org/W${id}`,
	type: "article",
	title: `Work ${id}`,
	updated_date: "2026-09-24T10:00:00Z",
	referenced_works: referencedWorks.map(
		(referencedId) => `https://openalex.org/W${referencedId}`,
	),
});

const page = (results: ReturnType<typeof work>[], nextCursor: string | null = null) =>
	Response.json({ meta: { count: results.length, next_cursor: nextCursor }, results });

async function addSource(db: Database, key: string, search = key) {
	await db.insert(sourceConnection).values({
		key,
		provider: "openalex",
		scopeKind: "query",
		config: settings(search),
	});
}

async function run(db: Database, key: string, request: typeof fetch) {
	const [connection] = await db
		.select()
		.from(sourceConnection)
		.where(eq(sourceConnection.key, key));
	return syncOpenAlexSource(
		{
			database: db,
			sourceConnection: connection!,
			credentialResolver: async () => "test-key",
			heartbeat: async () => {},
		},
		{ fetch: request, sleep: async () => {} },
	);
}

async function itemsByRecord(db: Database) {
	return new Map(
		(await db.select().from(item)).map((row) => [row.sourceRecordKey, row]),
	);
}

it("does not withdraw a work omitted by an incremental refresh", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await addSource(db, "oa");
		await run(db, "oa", async () => page([work(1), work(2)]));

		let requestedFilter: string | null = null;
		await run(db, "oa", async (input) => {
			requestedFilter = new URL(String(input)).searchParams.get("filter");
			return page([work(1)]);
		});

		expect(requestedFilter).toContain("from_updated_date:");
		const records = await itemsByRecord(db);
		expect(records.get("W2")?.deleted).toBe(0);
		const [membership] = await db
			.select()
			.from(itemSourceLink)
			.where(eq(itemSourceLink.sourceRecordKey, "W2"));
		expect(membership?.remoteDeleted).toBe(false);
		const [connection] = await db
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, "oa"));
		expect(connection?.syncCursor).toMatchObject({
			mode: "incremental",
			incrementalAvailable: true,
		});
	});
}, 120_000);

it("posts an OQL query and narrows an incremental refresh inside it", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const oql = "works where (title has (chatgpt) or abstract has (tutor)) and is_retracted is (false)";
		await db.insert(sourceConnection).values({
			key: "oa-oql",
			provider: "openalex",
			scopeKind: "query",
			config: { ...settings("unused"), approvedQuery: { ...settings("unused").approvedQuery, query: { oql } } },
		});
		const requests: { url: URL; method?: string; body?: string }[] = [];
		const record: typeof fetch = async (input, init) => {
			requests.push({ url: new URL(String(input)), method: init?.method, body: String(init?.body) });
			return page([work(1)]);
		};
		await run(db, "oa-oql", record);
		await run(db, "oa-oql", record);

		expect(requests.map(({ url, method }) => [url.pathname, method, url.searchParams.has("filter")])).toEqual([
			["/", "POST", false],
			["/", "POST", false],
		]);
		expect(JSON.parse(requests[0]!.body!)).toEqual({ oql });
		expect(JSON.parse(requests[1]!.body!).oql).toMatch(
			/^works where \(\(title has \(chatgpt\) or abstract has \(tutor\)\) and is_retracted is \(false\)\) and from_updated_date is \(\d{4}-\d{2}-\d{2}\)$/,
		);
	});
}, 120_000);

it("refreshes a sampled OQL query in full, since a sample of updated works is a different sample", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		const oql = "works where (title has (chatgpt)) and is_retracted is (false) sample 50 seed 7";
		await db.insert(sourceConnection).values({
			key: "oa-sample",
			provider: "openalex",
			scopeKind: "query",
			config: { ...settings("unused"), approvedQuery: { ...settings("unused").approvedQuery, query: { oql } } },
		});
		const bodies: string[] = [];
		const record: typeof fetch = async (_input, init) => {
			bodies.push(String(init?.body));
			return page([work(1)]);
		};
		await run(db, "oa-sample", record);
		await run(db, "oa-sample", record);
		expect(bodies.map((body) => JSON.parse(body).oql)).toEqual([oql, oql]);
		// A full scan reconciles, so works that leave the sample are withdrawn.
		const [connection] = await db
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, "oa-sample"));
		expect(connection?.syncCursor).toMatchObject({ mode: "full" });
	});
}, 120_000);

it("falls back after an incremental entitlement denial and withdraws only after the full scan completes", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await addSource(db, "oa");
		await run(db, "oa", async () => page([work(1), work(2)]));
		await db
			.update(sourceSnapshot)
			.set({ fetchedAt: new Date("2020-01-01T00:00:00Z") });

		const requests: Array<{ cursor: string | null; filter: string | null }> = [];
		await expect(
			run(db, "oa", async (input) => {
				const url = new URL(String(input));
				const request = {
					cursor: url.searchParams.get("cursor"),
					filter: url.searchParams.get("filter"),
				};
				requests.push(request);
				if (request.filter?.includes("from_updated_date:")) {
					return new Response(
						"Premium from_updated_date requires a paid key",
						{ status: 403 },
					);
				}
				if (request.cursor === "*") return page([work(1)], "page-2");
				return new Response("page unavailable", { status: 403 });
			}),
		).rejects.toMatchObject({ status: 403 });

		expect(requests).toEqual([
			expect.objectContaining({ filter: expect.stringContaining("from_updated_date:") }),
			{ cursor: "*", filter: null },
			{ cursor: "page-2", filter: null },
		]);
		expect((await itemsByRecord(db)).get("W2")?.deleted).toBe(0);
		expect(
			(
				await db
					.select()
					.from(itemSourceLink)
					.where(eq(itemSourceLink.sourceRecordKey, "W2"))
			)[0]?.remoteDeleted,
		).toBe(false);

		let resumedCursor: string | null = null;
		await run(db, "oa", async (input) => {
			resumedCursor = new URL(String(input)).searchParams.get("cursor");
			return page([]);
		});
		expect(resumedCursor).toBe("page-2");
		expect((await itemsByRecord(db)).get("W2")?.deleted).toBe(1);
		expect(
			(
				await db
					.select()
					.from(itemSourceLink)
					.where(eq(itemSourceLink.sourceRecordKey, "W2"))
			)[0]?.remoteDeleted,
		).toBe(true);
	});
}, 120_000);

it("runs a complete reconciliation when the last full scan is more than a week old", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await addSource(db, "oa");
		await run(db, "oa", async () => page([work(1), work(2)]));
		const [connection] = await db
			.select()
			.from(sourceConnection)
			.where(eq(sourceConnection.key, "oa"));
		await db
			.update(sourceConnection)
			.set({
				syncCursor: {
					...(connection!.syncCursor as Record<string, unknown>),
					reconciledAt: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(),
					incrementalAvailable: true,
				},
			})
			.where(eq(sourceConnection.key, "oa"));
		await db
			.update(sourceSnapshot)
			.set({ fetchedAt: new Date("2020-01-01T00:00:00Z") });

		let requestedFilter: string | null = "not requested";
		await run(db, "oa", async (input) => {
			requestedFilter = new URL(String(input)).searchParams.get("filter");
			return page([work(1)]);
		});

		expect(requestedFilter).toBeNull();
		expect((await itemsByRecord(db)).get("W2")?.deleted).toBe(1);
	});
}, 120_000);

it("resolves a citation when its target later arrives through another OpenAlex query", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await addSource(db, "oa-citing", "citing works");
		await addSource(db, "oa-cited", "cited works");
		await run(db, "oa-citing", async () => page([work(100, [200]), work(101, [200]), work(102, [200])]));

		const before = await itemsByRecord(db);
		const citingKey = before.get("W100")!.key;
		const depositedKey = before.get("W101")!.key;
		expect(await getPublicItemLinks(db, citingKey)).toEqual({
			cites: [],
			citedBy: [],
			related: [],
		});
		await db.insert(publicationTarget).values({
			itemKey: depositedKey,
			provider: "crossref",
			environment: "test",
			requestedBy: "citation-test",
			activatedAt: new Date(),
		});
		const events = async (key: string) => db.select().from(outbox).where(eq(outbox.entityKey, key));
		const eventIdsBefore = (await events(citingKey)).map((event) => event.id);
		// A search worker is indexing W102 right now.
		const indexedKey = before.get("W102")!.key;
		const leaseExpiresAt = new Date(Date.now() + 60_000);
		await db.update(outbox).set({ leaseOwner: "search-worker", leaseExpiresAt, processedAt: null }).where(eq(outbox.entityKey, indexedKey));
		const [leasedBefore] = await events(indexedKey);
		const queuedFrom = new Date();

		await run(db, "oa-cited", async () => page([work(200)]));
		const after = await itemsByRecord(db);
		const citedKey = after.get("W200")!.key;
		expect(await getPublicItemLinks(db, citingKey)).toMatchObject({
			cites: [citedKey],
		});
		expect(await getPublicItemLinks(db, citedKey)).toMatchObject({
			citedBy: [citingKey, depositedKey, before.get("W102")!.key].sort(),
		});
		// The citing record is unchanged, so it keeps its revision. Its search
		// event is queued again with a new id, which changes its public version.
		expect(after.get("W100")!.revision).toBe(before.get("W100")!.revision);
		const eventsAfter = await events(citingKey);
		expect(eventsAfter).toHaveLength(eventIdsBefore.length);
		const requeued = eventsAfter.find((event) => !eventIdsBefore.includes(event.id));
		expect(requeued).toMatchObject({ processedAt: null });
		expect(requeued!.createdAt.getTime()).toBeGreaterThanOrEqual(queuedFrom.getTime());
		// The worker's row is left alone, and the record takes a new revision so a fresh event follows it.
		expect((await events(indexedKey)).find((event) => event.id === leasedBefore!.id)).toMatchObject({ leaseOwner: "search-worker" });
		expect(after.get("W102")!.revision).toBe(before.get("W102")!.revision + 1);
		// A record with a publication target still takes a new revision, so its deposit is updated.
		expect(after.get("W101")!.revision).toBe(before.get("W101")!.revision + 1);
	});
}, 120_000);

it("leaves a source the sweep refreshed tonight until the next night, but runs it when asked", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await addSource(db, "oa-nightly");
		let requests = 0;
		const options = {
			credentialResolver: async () => "test-key",
			database: db,
			registry: new SourceAdapterRegistry([
				createOpenAlexSourceAdapter({
					fetch: async () => {
						requests += 1;
						return page([work(1)]);
					},
					sleep: async () => {},
				}),
			]),
			workerId: "nightly-test",
		};

		// Every community also has the Added papers source, which this sweep leaves to its own test.
		const nightly = (results: Awaited<ReturnType<typeof runActiveSourceConnections>>) => results.filter((result) => result.connectionKey === "oa-nightly");
		const first = await runActiveSourceConnections(options);
		const second = await runActiveSourceConnections(options);

		expect(nightly(first)).toEqual([expect.objectContaining({ connectionKey: "oa-nightly", status: "succeeded" })]);
		expect(nightly(second)).toEqual([{ connectionKey: "oa-nightly", status: "not_due" }]);
		expect(requests).toBe(1);
		await runSourceConnection({ ...options, sourceConnectionKey: "oa-nightly" });
		expect(requests).toBe(2);
		// An operator's one-off sweep runs every source, due or not.
		const forced = await runActiveSourceConnections({ ...options, force: true });
		expect(nightly(forced)).toEqual([expect.objectContaining({ connectionKey: "oa-nightly", status: "succeeded" })]);
		expect(requests).toBe(3);
	});
}, 120_000);

it("leaves a record alone when a refresh brings only OpenAlex's new update date, and takes a real change", async () => {
	await withIsolatedPublicationDatabase(async (db) => {
		await addSource(db, "oa-dates");
		await run(db, "oa-dates", async () => page([work(1)]));
		const before = (await itemsByRecord(db)).get("W1")!;
		const queued = async () => (await db.select().from(outbox).where(eq(outbox.entityKey, before.key))).length;
		const queuedBefore = await queued();

		// OpenAlex re-dates many works in bulk each night with nothing else changed.
		await run(db, "oa-dates", async () => page([{ ...work(1), updated_date: "2026-11-14T11:04:58Z" }]));
		const redated = (await itemsByRecord(db)).get("W1")!;
		expect(redated.revision).toBe(before.revision);
		expect(redated.updatedAt).toEqual(before.updatedAt);
		expect(await queued()).toBe(queuedBefore);

		await run(db, "oa-dates", async () => page([{ ...work(1), title: "Work 1, corrected", updated_date: "2026-11-15T11:04:58Z" }]));
		const changed = (await itemsByRecord(db)).get("W1")!;
		expect(changed.revision).toBe(before.revision + 1);
		expect(changed.title).toBe("Work 1, corrected");
		expect(changed.dateModified).toEqual(new Date("2026-11-15T11:04:58Z"));
		expect(await queued()).toBe(queuedBefore + 1);
	});
}, 120_000);
