// What OpenScholar changes in a library as one of its readers (plans/evidence-library-sources in OpenScholar): their
// collections and the records in them, and which records the library holds for papers OpenScholar names.
import { expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { generateCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { readerAccount, readerCollectionMember, readerUser } from "@/db/schema/tables/reader";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {}, after: vi.fn() }));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));

import { getDatabaseForConfig } from "@/db";
import { getLibraryConfig } from "@/config/library-config/server";
import { POST as create } from "@/app/api/v1/openscholar/readers/[clerkUserId]/collections/route";
import { DELETE as remove, POST as add } from "@/app/api/v1/openscholar/readers/[clerkUserId]/collections/[id]/records/route";
import { POST as match } from "@/app/api/v1/openscholar/records/match/route";

it("makes a reader's collection once, changes its records as its owner or editor only, and matches papers to records", async () => {
	await withIsolatedPublicationDatabase(async (database, sql) => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		vi.mocked(getDatabaseForConfig).mockResolvedValue(database);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		const headers = { Authorization: `Bearer ${config.authentication.openScholar.machineCredential}`, "OpenScholar-Contract": "1", "Content-Type": "application/json" };
		const request = (method: string, path: string, body: unknown) => new Request(`https://library.example.org${path}`, { method, headers, body: JSON.stringify(body) });
		const json = async (response: Response) => ({ status: response.status, body: await response.json() });

		// Two records from an OpenAlex search, one of them hidden, and one native record with a DOI.
		await sql.query(`INSERT INTO "sourceConnection" (key, provider, "scopeKind") VALUES ('openalex-main', 'openalex', 'query') ON CONFLICT DO NOTHING`);
		const [work, hidden, native] = [generateCanonicalRecordKey(), generateCanonicalRecordKey(), generateCanonicalRecordKey()];
		await sql.query(`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'openalex-main', 'W7'), ($2, 'openalex-main', 'W8'), ($3, 'native', $3)`, [work, hidden, native]);
		await sql.query(`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "DOI") VALUES ($1, 'openalex-main', 'W7', 'JournalArticle', 'Tutoring', NULL), ($2, 'openalex-main', 'W8', 'JournalArticle', 'Hidden', NULL), ($3, 'native', $3, 'JournalArticle', 'Camps', 'https://doi.org/10.1000/ABC')`, [work, hidden, native]);
		await sql.query(`UPDATE "item" SET "deleted" = 1 WHERE key = $1`, [hidden]);
		await sql.query(`INSERT INTO "itemSourceLink" ("itemKey", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'openalex-main', 'W7'), ($2, 'openalex-main', 'W8')`, [work, hidden]);
		// W70 was withdrawn as a repeat of W7; two native records share a DOI stored with a space after its prefix.
		await sql.query(`INSERT INTO "sourceRecordAlias" ("sourceConnectionKey", "aliasKey", "itemKey", "kind") VALUES ('openalex-main', 'W70', $1, 'duplicate-of')`, [work]);
		const twins = [generateCanonicalRecordKey(), generateCanonicalRecordKey()];
		await sql.query(`INSERT INTO "itemIdentity" ("key", "sourceConnectionKey", "sourceRecordKey") VALUES ($1, 'native', $1), ($2, 'native', $2)`, twins);
		await sql.query(`INSERT INTO "item" ("key", "sourceConnectionKey", "sourceRecordKey", "itemType", "title", "DOI") VALUES ($1, 'native', $1, 'JournalArticle', 'Twin', 'doi: 10.2000/twin'), ($2, 'native', $2, 'JournalArticle', 'Twin', 'doi: 10.2000/twin')`, twins);

		await database.insert(readerUser).values([
			{ id: "reader-amina", name: "Amina", email: "amina@readers.openscholar.invalid" },
			{ id: "reader-bob", name: "Bob", email: "bob@readers.openscholar.invalid" },
		]);
		await database.insert(readerAccount).values([
			{ id: "account-amina", userId: "reader-amina", providerId: "openscholar", accountId: "user_amina" },
			{ id: "account-bob", userId: "reader-bob", providerId: "openscholar", accountId: "user_bob" },
		]);

		// One collection per request, however often it's sent.
		const make = () => create(request("POST", "/api/v1/openscholar/readers/user_amina/collections", { name: "Included", private: true, requestId: "job-1" }), { params: Promise.resolve({ clerkUserId: "user_amina" }) });
		const made = await json(await make());
		expect(made).toMatchObject({ status: 201, body: { collection: { name: "Included", private: true, count: 0, access: "owner", owner: { name: "Amina" } } } });
		expect((await json(await make())).body.collection.id).toBe(made.body.collection.id);
		expect((await json(await create(request("POST", "/api/v1/openscholar/readers/user_nobody/collections", { name: "X", private: false, requestId: "r" }), { params: Promise.resolve({ clerkUserId: "user_nobody" }) }))).status).toBe(404);

		// Its owner puts records in; a record the library doesn't show isn't added, and is said so.
		const id = made.body.collection.id as string;
		const records = (verb: typeof add, clerkUserId: string, keys: string[]) => verb(request(verb === add ? "POST" : "DELETE", `/api/v1/openscholar/readers/${clerkUserId}/collections/${id}/records`, { keys }), { params: Promise.resolve({ clerkUserId, id }) });
		expect((await json(await records(add, "user_amina", [work, native, hidden]))).body).toEqual({ count: 2, changed: 2, missing: [hidden] });
		expect((await json(await records(add, "user_amina", [work]))).body).toEqual({ count: 2, changed: 0, missing: [] });

		// Someone it's shared with to view can't change it; once they edit it they can.
		await database.insert(readerCollectionMember).values({ collectionId: id, userId: "reader-bob", role: "viewer" });
		expect(await json(await records(remove, "user_bob", [work]))).toMatchObject({ status: 403, body: { error: "role" } });
		await database.update(readerCollectionMember).set({ role: "editor" }).where(eq(readerCollectionMember.userId, "reader-bob"));
		expect((await json(await records(remove, "user_bob", [work]))).body).toEqual({ count: 1, changed: 1, missing: [] });
		expect((await json(await add(request("POST", `/api/v1/openscholar/readers/user_amina/collections/${randomUUID()}/records`, { keys: [work] }), { params: Promise.resolve({ clerkUserId: "user_amina", id: randomUUID() }) }))).status).toBe(404);

		// Papers by their OpenAlex ID in any form, a repeat's included, or their DOI, each to the record that holds it, the
		// first by key when two share a DOI; a hidden record holds none.
		const matched = await json(await match(request("POST", "/api/v1/openscholar/records/match", { reader: "user_amina", papers: [{ openalexId: "https://openalex.org/W7" }, { doi: "10.1000/abc" }, { openalexId: "W8" }, { doi: "10.9/none" }, {}, { openalexId: "W70" }, { doi: "10.2000/TWIN" }] })));
		expect(matched.body).toEqual({ matches: [{ at: 0, key: work }, { at: 1, key: native }, { at: 5, key: work }, { at: 6, key: twins.toSorted()[0] }] });
	});
});
