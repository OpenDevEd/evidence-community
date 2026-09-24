import { expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { eq } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { itemSourceLink, sourceConnection, sourceSnapshot } from "@/db/schema/source";
import type { Database } from "@/db/database-schema";
import { getPublicItemLinks } from "@/lib/links/item-links";
import { syncOpenAlexSource } from "@/lib/source-ingestion/openalex/sync";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

const settings = (search: string) => ({
	name: "AI in education",
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

it("runs a complete reconciliation when the last full scan is more than 24 hours old", async () => {
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
					reconciledAt: new Date(Date.now() - 25 * 60 * 60_000).toISOString(),
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
		await run(db, "oa-citing", async () => page([work(100, [200])]));

		const before = await itemsByRecord(db);
		const citingKey = before.get("W100")!.key;
		expect(await getPublicItemLinks(db, citingKey)).toEqual({
			cites: [],
			citedBy: [],
			related: [],
		});

		await run(db, "oa-cited", async () => page([work(200)]));
		const after = await itemsByRecord(db);
		const citedKey = after.get("W200")!.key;
		expect(await getPublicItemLinks(db, citingKey)).toMatchObject({
			cites: [citedKey],
		});
		expect(await getPublicItemLinks(db, citedKey)).toMatchObject({
			citedBy: [citingKey],
		});
	});
}, 120_000);
