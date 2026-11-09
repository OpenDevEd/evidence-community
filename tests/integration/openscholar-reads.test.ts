import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer, type AddressInfo } from "node:net";
import { generateCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { Meilisearch } from "meilisearch";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { readerAccount, readerCollectionItem, readerCollectionMember, readerUser } from "@/db/schema/tables/reader";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {}, after: vi.fn() }));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));

import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { createReaderCollection } from "@/lib/readers/data";
import { GET as readers } from "@/app/api/v1/openscholar/readers/route";
import { GET as readerCollections } from "@/app/api/v1/openscholar/readers/[clerkUserId]/collections/route";
import { GET as oneCollection } from "@/app/api/v1/openscholar/collections/[id]/route";
import { POST as resolve } from "@/app/api/v1/openscholar/sources/resolve/route";
import { POST as batch } from "@/app/api/v1/openscholar/records/batch/route";
import { GET as overview } from "@/app/api/v1/openscholar/library/route";

let client: Meilisearch;
let host: string;
let ownedContainer: string | undefined;

beforeAll(async () => {
	host = process.env.EVIDENCE_LIBRARY_TEST_MEILI_URL ?? "";
	if (!host) {
		ownedContainer = `openscholar-reads-${randomUUID()}`;
		const probe = createServer().listen(0, "127.0.0.1");
		await once(probe, "listening");
		const { port } = probe.address() as AddressInfo;
		probe.close();
		execFileSync("docker", ["run", "--detach", "--rm", "--name", ownedContainer, "--publish", `127.0.0.1:${port}:7700`, "--env", "MEILI_NO_ANALYTICS=true", "getmeili/meilisearch:v1.54"]);
		host = `http://127.0.0.1:${port}`;
	}
	client = new Meilisearch({ host, apiKey: process.env.EVIDENCE_LIBRARY_TEST_MEILI_KEY, defaultWaitOptions: { timeout: 30_000 } });
	await vi.waitFor(async () => expect((await client.health()).status).toBe("available"), { timeout: 15_000 });
});

afterAll(() => {
	if (ownedContainer) execFileSync("docker", ["stop", ownedContainer]);
});

async function successful(task: { waitTask: () => Promise<{ status: string }> }) {
	expect((await task.waitTask()).status).toBe("succeeded");
}

it("answers OpenScholar's reads as the person it names, within what the library lets that person see", async () => {
	await withIsolatedPublicationDatabase(async (database, sql) => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		config.services.search = { engine: "meilisearch", meilisearch: { host, key: process.env.EVIDENCE_LIBRARY_TEST_MEILI_KEY ?? "", index: `osreads_${randomUUID().replaceAll("-", "")}` } };
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		const { machineCredential } = config.authentication.openScholar;
		const headers = { Authorization: `Bearer ${machineCredential}`, "OpenScholar-Contract": "1", "Content-Type": "application/json" };
		const get = (path: string, extra: Record<string, string> = headers) => new Request(`https://library.example.org${path}`, { headers: extra });
		const post = (path: string, body: unknown) => new Request(`https://library.example.org${path}`, { method: "POST", headers, body: JSON.stringify(body) });
		const json = async (response: Response) => ({ status: response.status, body: await response.json() });

		const keys = Array.from({ length: 3 }, () => generateCanonicalRecordKey()).sort();
		const camps = generateCanonicalRecordKey();
		await sql.query(`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") SELECT key, 'native', key FROM unnest($1::text[]) key`, [keys]);
		await sql.query(`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "date") SELECT key, 'native', key, 'JournalArticle', 'Saved ' || key, '2024' FROM unnest($1::text[]) key`, [keys]);
		const index = client.index(config.services.search.meilisearch!.index);
		await successful(client.createIndex(index.uid, { primaryKey: "key" }));
		await successful(index.updateSettings({ pagination: { maxTotalHits: 30_000 }, filterableAttributes: ["key", "itemType", "deleted", "tags", "year", "collectionsAncestry", "country"], sortableAttributes: ["title", "dateSortKey"] }));
		await successful(index.addDocuments([
			{ key: keys[0], title: "Tutoring at scale", itemType: "JournalArticle", deleted: 0, tags: [], year: 2021, date: "2021-03-01", provider: "openalex", sourceRecordKey: "W7", openalexId: "W7", DOI: "https://doi.org/10.1000/ABC", creators: [{ creatorType: "author", firstName: "Ada", lastName: "Okafor" }], abstractNote: "Tutors help.", publicationTitle: "A journal", country: ["ke"], attachmentsData: [{ key: "PDFAAAAA", itemType: "Attachment", contentType: "application/pdf", filename: "paper.pdf", url: "https://files.example.test/paper.pdf", deleted: 0, tags: [] }, { key: "PDFBBBBB", itemType: "Attachment", contentType: "application/pdf", filename: "unstored.pdf", deleted: 0, tags: [] }, { key: "NOTEAAAA", itemType: "Note", deleted: 0, tags: [] }] },
			{ key: keys[1], title: "Reading camps", itemType: "JournalArticle", deleted: 0, tags: [], year: 2022, collectionsAncestry: [camps], country: ["ke", "ug"] },
			{ key: keys[2], title: "Coaching", itemType: "Report", deleted: 0, tags: [], year: 2023 },
			// Deleted since a source was resolved: the index still holds it.
			{ key: "GONEGONE", title: "Withdrawn", itemType: "JournalArticle", deleted: 1, tags: [], year: 2020, collectionsAncestry: [camps], country: ["tz"] },
		]));
		await sql.query(`INSERT INTO "collectionIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1)`, [camps]);
		await sql.query(`INSERT INTO "collection" ("key", "sourceConnectionKey", "sourceRecordKey", "name", "numItems", "sortOrder") VALUES ($1, 'native', $1, 'Camps', 0, 1)`, [camps]);
		config.collections = [{ id: camps, title: "Camps", enabled: true, order: 1 }];

		const amina = "reader-user_amina";
		const bob = "reader-user_bob";
		await database.insert(readerUser).values([
			{ id: amina, name: "Amina Okafor", email: "user_amina@readers.openscholar.invalid" },
			{ id: bob, name: "Bob", email: "user_bob@readers.openscholar.invalid" },
		]);
		await database.insert(readerAccount).values([
			{ id: "account-amina", userId: amina, providerId: "openscholar", accountId: "user_amina" },
			{ id: "account-bob", userId: bob, providerId: "openscholar", accountId: "user_bob" },
		]);
		const { id: mine } = await createReaderCollection(database, amina, { name: "Only mine", description: null, private: true });
		const { id: open } = await createReaderCollection(database, amina, { name: "Open", description: "For everyone", private: false });
		await database.insert(readerCollectionItem).values([{ collectionId: mine, itemKey: keys[2] }, { collectionId: mine, itemKey: keys[0] }, { collectionId: open, itemKey: keys[1] }]);

		// The machine credential and the contract version come first.
		expect((await readers(get("/api/v1/openscholar/readers", { Authorization: "Bearer wrong", "OpenScholar-Contract": "1" }))).status).toBe(401);
		expect(await json(await readers(get("/api/v1/openscholar/readers", { Authorization: `Bearer ${machineCredential}` })))).toMatchObject({ status: 400, body: { error: "contract" } });
		expect((await json(await readers(get("/api/v1/openscholar/readers")))).body).toEqual({ readers: ["user_amina", "user_bob"], next: null });

		// A person's own collections, private ones too; what's shared with them; nothing for someone who never signed in.
		const own = await json(await readerCollections(get("/api/v1/openscholar/readers/user_amina/collections?list=own"), { params: Promise.resolve({ clerkUserId: "user_amina" }) }));
		expect(own.body.rows.map((row: { name: string; count: number; access: string }) => [row.name, row.count, row.access])).toEqual([["Only mine", 2, "owner"], ["Open", 1, "owner"]]);
		const shared = () => readerCollections(get("/api/v1/openscholar/readers/user_bob/collections?list=shared"), { params: Promise.resolve({ clerkUserId: "user_bob" }) });
		expect((await json(await shared())).body.rows).toEqual([]);
		expect((await json(await readerCollections(get("/api/v1/openscholar/readers/user_nobody/collections"), { params: Promise.resolve({ clerkUserId: "user_nobody" }) }))).body).toEqual({ rows: [], page: 1, pages: 1, total: 0 });

		// A private collection is refused to anyone but its owner and its members, by its ID and as a source.
		const collection = (reader: string) => oneCollection(get(`/api/v1/openscholar/collections/${mine}?reader=${reader}`), { params: Promise.resolve({ id: mine }) });
		expect(await json(await collection("user_bob"))).toMatchObject({ status: 403, body: { error: "private" } });
		expect(await json(await resolve(post("/api/v1/openscholar/sources/resolve", { reader: "user_bob", source: { readerCollection: mine } })))).toMatchObject({ status: 403, body: { error: "private" } });
		expect((await json(await collection("user_amina"))).body).toMatchObject({ name: "Only mine", private: true, count: 2, access: "owner", owner: { name: "Amina Okafor" } });
		await database.insert(readerCollectionMember).values({ collectionId: mine, userId: bob, role: "viewer" });
		expect((await json(await collection("user_bob"))).body).toMatchObject({ access: "viewer" });
		expect((await json(await shared())).body.rows.map((row: { name: string; owner: { name: string } }) => [row.name, row.owner.name])).toEqual([["Only mine", "Amina Okafor"]]);
		const resolved = (await json(await resolve(post("/api/v1/openscholar/sources/resolve", { reader: "user_bob", source: { readerCollection: mine } })))).body;
		expect({ ...resolved, keys: resolved.keys.toSorted() }).toEqual({ keys: [keys[0], keys[2]], total: 2, truncated: false });
		expect(await json(await resolve(post("/api/v1/openscholar/sources/resolve", { reader: null, source: { readerCollection: randomUUID() } })))).toMatchObject({ status: 404 });

		// The library's own collection, the whole library from a place in it, and a list, each as the library holds them.
		expect((await json(await resolve(post("/api/v1/openscholar/sources/resolve", { reader: null, source: { libraryCollection: camps } })))).body.keys).toEqual([keys[1]]);
		// The library's own collections count what resolving them reads, whatever their stored count says; its countries are its public records', most first.
		expect((await json(await overview(get("/api/v1/openscholar/library")))).body).toEqual({ records: 3, countries: [{ code: "ke", records: 2 }, { code: "ug", records: 1 }], collections: [{ key: camps, name: "Camps", parent: null, records: 1 }] });
		// A window past the first records of a search.
		expect((await json(await resolve(post("/api/v1/openscholar/sources/resolve", { reader: "user_amina", source: { readerCollection: mine }, first: 2, last: 2 })))).body).toMatchObject({ keys: [expect.any(String)], total: 2 });
		const whole = await json(await resolve(post("/api/v1/openscholar/sources/resolve", { reader: null, source: { library: true }, first: 2, last: 3 })));
		expect(whole.body.keys).toEqual(keys.slice(1, 3));
		expect((await json(await resolve(post("/api/v1/openscholar/sources/resolve", { reader: null, source: { records: [keys[2], "NOSUCHKY", keys[0]] } })))).body).toEqual({ keys: [keys[2], keys[0]], total: 2, truncated: false });
		expect(await json(await resolve(post("/api/v1/openscholar/sources/resolve", { reader: null, source: { library: true }, first: 1, last: 20_001 })))).toMatchObject({ status: 413, body: { error: "too_many" } });

		// Records by key, with what finds them elsewhere and their public PDFs only.
		const records = await json(await batch(post("/api/v1/openscholar/records/batch", { keys: [keys[0], "NOSUCHKY", "GONEGONE", keys[1]] })));
		expect(records.body.unread).toEqual([]);
		expect(records.body.records.map((record: { key: string }) => record.key)).toEqual([keys[0], keys[1]]);
		expect(records.body.records[0]).toMatchObject({ title: "Tutoring at scale", abstract: "Tutors help.", creators: [{ name: "Ada Okafor" }], year: 2021, venue: "A journal", crossRefs: { openalexId: "W7", doi: "10.1000/abc" }, files: [{ attachmentKey: "PDFAAAAA", filename: "paper.pdf", contentType: "application/pdf" }] });
		expect(records.body.records[1].crossRefs).toEqual({});
	});
});
