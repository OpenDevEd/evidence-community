import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/app/api/auth/[...nextauth]/config", () => ({ auth: vi.fn() }));
// The library's own collections are not under test; the reader's collections are read for real.
vi.mock("@/app/api/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/app/api/cache")>()),
	getCachedCollections: async () => [],
}));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
vi.mock("@/lib/runtime-feature", () => ({
	getConfigForEnabledFeature: vi.fn(),
	featureUnavailableResponse: () => new Response(null, { status: 404 }),
}));
const search = vi.hoisted(() => ({
	search: vi.fn(),
	getDisplayedAttributes: async () => ["*"],
	getStats: async () => ({ fieldDistribution: { key: 1, title: 1 } }),
}));
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: async () => ({ index: search }) }));

import { auth } from "@/app/api/auth/[...nextauth]/config";
import { GET } from "@/app/api/user/items/[id]/route";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase, getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { itemToUserCollection } from "@/db/schema/tables/itemToUserCollection";
import { users } from "@/db/schema/tables/user";
import { userCollection } from "@/db/schema/tables/userCollection";
import { createNativeItemDraft, publishItemDraft } from "@/lib/admin/native-item-service";
import { getConfigForEnabledFeature } from "@/lib/runtime-feature";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const OWNER = "reader-owner";

beforeEach(() => {
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	vi.mocked(getConfigForEnabledFeature).mockResolvedValue(config as never);
	search.search.mockReset().mockImplementation(async () => ({ estimatedTotalHits: 0, hits: [] }));
});

function readCollection(collectionId: string) {
	return GET(new NextRequest(`https://library.example/api/user/items/${OWNER}?collectionId=${collectionId}`), {
		params: Promise.resolve({ id: OWNER }),
	});
}

function signIn(userId: string | null) {
	vi.mocked(auth).mockResolvedValue((userId ? { user: { id: userId } } : null) as never);
}

async function withCollections(
	verify: (collections: { emptyPrivate: string; savedPrivate: string; itemKey: string }) => Promise<void>,
) {
	await withIsolatedPublicationDatabase(async (db: Database) => {
		vi.mocked(getDatabase).mockResolvedValue(db);
		vi.mocked(getDatabaseForConfig).mockResolvedValue(db);
		await db.insert(users).values({ id: OWNER, name: "Owner" });
		const { itemKey } = await createNativeItemDraft(db, { itemType: "Report", title: "Saved report" });
		await publishItemDraft(db, itemKey);
		const [emptyPrivate, savedPrivate] = await db
			.insert(userCollection)
			.values([
				{ userId: OWNER, name: "Empty and private", private: true },
				{ userId: OWNER, name: "Saved and private", private: true },
			])
			.returning({ id: userCollection.id });
		await db.insert(itemToUserCollection).values({ itemKey, userCollectionId: savedPrivate!.id, userId: OWNER });
		await verify({ emptyPrivate: emptyPrivate!.id, savedPrivate: savedPrivate!.id, itemKey });
	});
}

it("refuses someone else's private collection, empty or not, without searching the library", async () => {
	await withCollections(async ({ emptyPrivate, savedPrivate }) => {
		for (const visitor of ["another-reader", null]) {
			signIn(visitor);
			expect((await readCollection(emptyPrivate)).status).toBe(403);
			expect((await readCollection(savedPrivate)).status).toBe(403);
		}
		expect(search.search).not.toHaveBeenCalled();
	});
});

it("lists only a private collection's own records to its owner", async () => {
	await withCollections(async ({ savedPrivate, itemKey }) => {
		signIn(OWNER);
		expect((await readCollection(savedPrivate)).status).toBe(200);
		expect(search.search.mock.lastCall?.[1].filter).toContainEqual(`key IN ["${itemKey}"]`);
	});
});

it("answers 404 for a collection that does not exist instead of listing the whole library", async () => {
	await withCollections(async () => {
		signIn(OWNER);
		expect((await readCollection("00000000-0000-4000-8000-000000000000")).status).toBe(404);
		expect((await readCollection("not-a-collection")).status).toBe(404);
		expect(search.search).not.toHaveBeenCalled();
	});
});
