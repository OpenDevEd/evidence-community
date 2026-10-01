import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { signedInHeaders } from "../helpers/reader-session";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/lib/readers/session", () => import("../helpers/reader-session"));
// The library's own collections are not under test; the reader's collections are read for real.
vi.mock("@/app/api/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/app/api/cache")>()),
	getCachedCollections: async () => [],
}));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));
const search = vi.hoisted(() => ({
	search: vi.fn(),
	getDisplayedAttributes: async () => ["*"],
	getStats: async () => ({ fieldDistribution: { key: 1, title: 1 } }),
}));
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: async () => ({ index: search }) }));

import { GET } from "@/app/api/user/items/[id]/route";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase, getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { readerCollection, readerCollectionItem, readerUser } from "@/db/schema/tables/reader";
import { createNativeItemDraft, publishItemDraft } from "@/lib/admin/native-item-service";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const OWNER_CLERK_ID = "user_owner";
const OWNER = `reader-${OWNER_CLERK_ID}`;

beforeEach(() => {
	vi.mocked(getLibraryConfig).mockResolvedValue(config);
	search.search.mockReset().mockImplementation(async () => ({ estimatedTotalHits: 0, hits: [] }));
});

function readList(collectionId: string, clerkUserId?: string) {
	requestHeaders.current = signedInHeaders(clerkUserId);
	return GET(new NextRequest(`https://library.example/api/user/items/${OWNER}?collectionId=${collectionId}`), {
		params: Promise.resolve({ id: OWNER }),
	});
}

async function withCollections(
	verify: (collections: { emptyPrivate: string; savedPrivate: string; itemKey: string }) => Promise<void>,
) {
	await withIsolatedPublicationDatabase(async (db: Database) => {
		vi.mocked(getDatabase).mockResolvedValue(db);
		vi.mocked(getDatabaseForConfig).mockResolvedValue(db);
		await db.insert(readerUser).values({ id: OWNER, name: "Owner", email: "owner@example.org" });
		const { itemKey } = await createNativeItemDraft(db, { itemType: "Report", title: "Saved report" });
		await publishItemDraft(db, itemKey);
		const [emptyPrivate, savedPrivate] = await db
			.insert(readerCollection)
			.values([
				{ userId: OWNER, name: "Empty and private", private: true },
				{ userId: OWNER, name: "Saved and private", private: true },
			])
			.returning({ id: readerCollection.id });
		await db.insert(readerCollectionItem).values({ itemKey, collectionId: savedPrivate!.id });
		await verify({ emptyPrivate: emptyPrivate!.id, savedPrivate: savedPrivate!.id, itemKey });
	});
}

it("refuses someone else's private collection, empty or not, without searching the library", async () => {
	await withCollections(async ({ emptyPrivate, savedPrivate }) => {
		for (const visitor of ["user_other", undefined]) {
			expect((await readList(emptyPrivate, visitor)).status).toBe(403);
			expect((await readList(savedPrivate, visitor)).status).toBe(403);
		}
		expect(search.search).not.toHaveBeenCalled();
	});
});

it("lists only a private collection's own records to its owner", async () => {
	await withCollections(async ({ savedPrivate, itemKey }) => {
		expect((await readList(savedPrivate, OWNER_CLERK_ID)).status).toBe(200);
		expect(search.search.mock.lastCall?.[1].filter).toContainEqual(`key IN ["${itemKey}"]`);
	});
});

it("answers 404 for a collection that is not this reader's instead of listing the whole library", async () => {
	await withCollections(async () => {
		expect((await readList("00000000-0000-4000-8000-000000000000", OWNER_CLERK_ID)).status).toBe(404);
		expect((await readList("not-a-collection", OWNER_CLERK_ID)).status).toBe(404);
		expect(search.search).not.toHaveBeenCalled();
	});
});
