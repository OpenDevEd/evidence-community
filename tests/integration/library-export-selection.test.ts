import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { generateCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { Meilisearch } from "meilisearch";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { signInReaders } from "../helpers/reader-test-sessions";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { normalizeLibrarySearchContext } from "@/lib/search-context";
import { readerCollection, readerCollectionItem, readerUser } from "@/db/schema/tables/reader";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {}, after: vi.fn() }));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getRuntimeRequestLocale: async () => "en-GB" }));

import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { prepareLibraryExport } from "@/lib/library-export-selection";
import { GET, POST } from "@/app/api/exports/[format]/route";

let client: Meilisearch;
let host: string;
let ownedContainer: string | undefined;

beforeAll(async () => {
	host = process.env.EVIDENCE_LIBRARY_TEST_MEILI_URL ?? "";
	if (!host) {
		ownedContainer = `export-selection-${randomUUID()}`;
		// The CI guest runs several rootless Docker daemons, and each hands out host ports without
		// seeing the others' bindings, so take a port the guest reports free.
		const probe = createServer().listen(0, "127.0.0.1");
		await once(probe, "listening");
		const { port } = probe.address() as AddressInfo;
		probe.close();
		execFileSync("docker", ["run", "--detach", "--rm", "--name", ownedContainer, "--publish", `127.0.0.1:${port}:7700`, "--env", "MEILI_NO_ANALYTICS=true", "getmeili/meilisearch:v1.54"]);
		host = `http://127.0.0.1:${port}`;
	}
	client = new Meilisearch({ host, apiKey: process.env.EVIDENCE_LIBRARY_TEST_MEILI_KEY });
	await vi.waitFor(async () => expect((await client.health()).status).toBe("available"), { timeout: 15_000 });
});

afterAll(() => {
	if (ownedContainer) execFileSync("docker", ["stop", ownedContainer]);
});

async function successful(task: { waitTask: () => Promise<{ status: string }> }) {
	expect((await task.waitTask()).status).toBe("succeeded");
}

it("exports an ordered multi-page search from public database records and detects changed selections", async () => {
	await withIsolatedPublicationDatabase(async (database, sql) => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		config.content.tags.hidden = ["hidden"];
		config.topics.enabled = true;
		config.services.search = { host, key: process.env.EVIDENCE_LIBRARY_TEST_MEILI_KEY ?? "", index: `export_${randomUUID().replaceAll("-", "")}` };
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		const index = client.index(config.services.search.index);
		await successful(client.createIndex(index.uid, { primaryKey: "key" }));
		try {
			const keys = Array.from({ length: 503 }, () => generateCanonicalRecordKey()).sort();
			await sql.query(`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") SELECT key, 'native', key FROM unnest($1::text[]) key`, [keys]);
			await sql.query(`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "date") SELECT key, 'native', key, 'JournalArticle', 'Saved ' || key, '2024' FROM unnest($1::text[]) key`, [keys]);
			await successful(index.updateSettings({ pagination: { maxTotalHits: 30_000 }, filterableAttributes: ["key", "itemType", "deleted", "tags", "year", "institutionsWithAuthors", "country", "fullNames", "collectionsAncestry", "topicAncestors"], sortableAttributes: ["title", "dateSortKey"] }));
			await successful(index.addDocuments(keys.map(key => ({ key, title: `Indexed evidence ${key}`, itemType: "JournalArticle", deleted: 0, tags: [], year: 2024, dateSortKey: 2024 }))));
			const context = normalizeLibrarySearchContext({ search: "evidence", scope: "title", sort: "titleZA", range: "2024" });
			const selection = { scope: "results" as const, context };
			const request = () => new Request("https://maximal.example.org/api/exports/ris", { method: "POST", body: JSON.stringify(selection) });
			const prepared = await prepareLibraryExport(config, selection, request());
			expect(prepared.count).toBe(503);
			const first = await prepared.readPage(null, 250);
			const second = await prepared.readPage(first.at(-1)!.key, 250);
			const last = await prepared.readPage(second.at(-1)!.key, 250);
			expect([...first, ...second, ...last].map(row => row.key)).toEqual(keys.toReversed());
			expect(first[0].title).toBe(`Saved ${keys.at(-1)}`);
			const response = await POST(request(), { params: Promise.resolve({ format: "ris" }) });
			expect(response.status).toBe(200);
			expect(response.headers.get("X-Export-Count")).toBe("503");
			const text = await response.text();
			expect([...text.matchAll(/TY  - /g)]).toHaveLength(503);
			expect(text).toContain(`Saved ${keys.at(-1)}`);
			expect(text).not.toContain("Indexed evidence");

			await sql.query(`INSERT INTO "topicCatalogCache" (id, kind, payload) VALUES ('T1', 'node', $1)`, [JSON.stringify({ id: "T1", name: "Education", parent: null, level: "topic", path: ["Education"], childCount: 0 })]);
			await successful(index.updateDocuments([{ key: keys[0], itemType: "Report", institutionsWithAuthors: ["Research Institute"], country: ["MA"], fullNames: ["Amina Researcher"], collectionsAncestry: ["education"], topicAncestors: ["T1"] }]));
			const filters = [{ type: ["Report"] }, { institution: ["Research Institute"] }, { country: ["MA"] }, { author: "Amina Researcher" }, { collections: ["education"] }, { topics: ["T1"] }];
			for (const filter of [...filters, Object.assign({}, ...filters)]) {
				const filtered = await prepareLibraryExport(config, { scope: "results", context: { ...context, ...filter } }, request());
				expect((await filtered.readPage(null, 250)).map(row => row.key)).toEqual([keys[0]]);
			}
			const missing = await prepareLibraryExport(config, { scope: "results", context: { ...context, type: ["UnknownType"] } }, request());
			expect(missing.count).toBe(0);
			expect(await missing.readPage(null, 250)).toEqual([]);

			const service = await getMeilisearchForConfig(config);
			const realSearch = service.index.search.bind(service.index);
			const unrelated = client.index(`${index.uid}_cache`);
			await successful(client.createIndex(unrelated.uid, { primaryKey: "id" }));
			try {
				vi.spyOn(service.index, "search").mockImplementationOnce(async (...args) => {
					const page = await realSearch(...args);
					await successful(unrelated.addDocuments([{ id: "statistics", count: 503 }]));
					return page;
				});
				const unchanged = await prepareLibraryExport(config, { ...selection, expectedCount: 503 }, request());
				expect(unchanged.count).toBe(503);
			} finally {
				vi.mocked(service.index.search).mockRestore();
				await successful(client.deleteIndex(unrelated.uid));
			}
			const search = vi.spyOn(service.index, "search");
			search.mockImplementationOnce(async (...args) => {
				const page = await realSearch(...args);
				await successful(index.updateDocuments([{ key: keys[0], title: "Reordered evidence" }]));
				return page;
			});
			await expect(prepareLibraryExport(config, selection, request())).rejects.toMatchObject({ code: "exportChanged" });
			search.mockRestore();

			const replacement = `${index.uid}_replacement`;
			await successful(client.createIndex(replacement, { primaryKey: "key" }));
			await successful(client.index(replacement).updateSettings(await index.getSettings()));
			await successful(client.index(replacement).addDocuments(keys.map(key => ({ key, title: `Replacement evidence ${key}`, itemType: "JournalArticle", deleted: 0, tags: [], year: 2024 }))));
			try {
				vi.spyOn(service.index, "search").mockImplementationOnce(async (...args) => {
					const page = await realSearch(...args);
					await successful(client.swapIndexes([{ indexes: [index.uid, replacement], rename: false }]));
					return page;
				});
				await expect(prepareLibraryExport(config, selection, request())).rejects.toMatchObject({ code: "exportChanged" });
			} finally {
				vi.mocked(service.index.search).mockRestore();
				await successful(client.deleteIndex(replacement));
			}

			const interrupted = await POST(request(), { params: Promise.resolve({ format: "ris" }) });
			expect(interrupted.status).toBe(200);
			const stream = interrupted.body!.getReader();
			const firstChunk = await stream.read();
			expect(new TextDecoder().decode(firstChunk.value).match(/TY  - /g)).toHaveLength(250);
			await sql.query(`UPDATE "item" SET "deleted" = 1 WHERE "key" = $1`, [keys[0]]);
			await expect((async () => { while (!(await stream.read()).done) { /* Drain every page. */ } })()).rejects.toMatchObject({ code: "exportChanged" });
			await sql.query(`UPDATE "item" SET "deleted" = 0 WHERE "key" = $1`, [keys[0]]);
			await sql.query(`UPDATE "item" SET "deleted" = 1 WHERE "key" = $1`, [keys.at(-1)]);
			await expect(prepared.readPage(null, 250)).rejects.toMatchObject({ code: "exportChanged" });
			const abort = new AbortController();
			abort.abort();
			await expect(prepareLibraryExport(config, selection, new Request(request(), { signal: abort.signal }))).rejects.toMatchObject({ name: "AbortError" });

			const owner = "reader-user_export_owner";
			await database.insert(readerUser).values({ id: owner, name: "Owner", email: "owner@example.org" });
			const signedIn = await signInReaders(database, config, ["user_export_owner", "user_export_other"]);
			const [collection] = await database.insert(readerCollection).values({ userId: owner, name: "Private", private: true }).returning();
			await database.insert(readerCollectionItem).values({ collectionId: collection.id, itemKey: keys[0] });
			const readerSelection = { scope: "results" as const, context: { ...context, search: "", readerList: { userId: owner, collectionId: collection.id } } };
			for (const visitor of [undefined, "user_export_other"]) {
				const denied = new Request(request(), { headers: signedIn(visitor), body: JSON.stringify(readerSelection) });
				expect((await POST(denied, { params: Promise.resolve({ format: "ris" }) })).status).toBe(403);
			}
			const ownRequest = new Request(request(), { headers: signedIn("user_export_owner"), body: JSON.stringify(readerSelection) });
			const ownExport = await prepareLibraryExport(config, readerSelection, ownRequest);
			expect((await ownExport.readPage(null, 250)).map(row => row.key)).toEqual([keys[0]]);
			await database.delete(readerCollectionItem).where(eq(readerCollectionItem.collectionId, collection.id));
			await expect(ownExport.readPage(null, 250)).rejects.toMatchObject({ code: "exportChanged" });
			const empty = await POST(new Request(ownRequest), { params: Promise.resolve({ format: "ris" }) });
			expect(empty.status).toBe(200);
			expect(empty.headers.get("X-Export-Count")).toBe("0");
			expect(await empty.text()).toBe("");
		} finally {
			await successful(client.deleteIndex(index.uid));
		}
	});
}, 120_000);

it("refuses the 20,001st public record before returning a file and rejects malformed filters", async () => {
	await withIsolatedPublicationDatabase(async (database, sql) => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		const keys = Array.from({ length: 20_001 }, () => generateCanonicalRecordKey());
		await sql.query(`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") SELECT key, 'native', key FROM unnest($1::text[]) key`, [keys]);
		// The projection triggers hold per-record locks until each insert commits.
		for (let offset = 0; offset < keys.length; offset += 500) {
			await sql.query(`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title") SELECT key, 'native', key, 'Report', 'Report' FROM unnest($1::text[]) key`, [keys.slice(offset, offset + 500)]);
		}
		const route = { params: Promise.resolve({ format: "ris" }) };
		const response = await GET(new Request("https://maximal.example.org/api/exports/ris"), route);
		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({ code: "exportTooLarge" });
		for (const context of [{ ...normalizeLibrarySearchContext({}), range: "2025-2020" }, { ...normalizeLibrarySearchContext({}), sort: "wrong" }, { ...normalizeLibrarySearchContext({}), extra: "dropped" }]) {
			const refused = await POST(new Request("https://maximal.example.org/api/exports/ris", { method: "POST", body: JSON.stringify({ scope: "results", context }) }), route);
			expect(refused.status).toBe(400);
		}
	});
}, 120_000);
