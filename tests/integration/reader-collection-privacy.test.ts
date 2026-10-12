import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";
import { signInReaders } from "../helpers/reader-test-sessions";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife() {}, cacheTag() {} }));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
// The library's own collections are not under test; the reader's collections are read for real.
vi.mock("@/app/api/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/app/api/cache")>()),
	getCachedCollections: async () => [],
}));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));
// Reading a session schedules an account check after the response, and the reader's routes wait for a request, neither of which is under test here.
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), after: vi.fn(), connection: async () => {} }));
const search = vi.hoisted(() => ({
	search: vi.fn(),
	getDisplayedAttributes: async () => ["*"],
	getStats: async () => ({ fieldDistribution: { key: 1, title: 1 } }),
}));
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: async () => ({ index: search }) }));

import { GET } from "@/app/api/user/items/[id]/route";
import { POST as toggleItem } from "@/app/api/reader/collections/[id]/items/route";
import { DELETE as removeMember } from "@/app/api/reader/collections/[id]/members/[userId]/route";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabase, getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { readerCollection, readerCollectionItem, readerCollectionMember, readerUser, type ReaderCollectionRole } from "@/db/schema/tables/reader";
import { createNativeItemDraft, publishItemDraft } from "@/lib/admin/native-item-service";
import { joinCollection, setCollectionMemberRole } from "@/lib/readers/data";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const OWNER_CLERK_ID = "user_owner";
const OWNER = `reader-${OWNER_CLERK_ID}`;
const OTHER_CLERK_ID = "user_other";
const OTHER = `reader-${OTHER_CLERK_ID}`;

let signedInHeaders: (clerkUserId?: string) => Headers;

beforeEach(() => {
	// A copy, so each test database gets its own auth instance.
	vi.mocked(getLibraryConfig).mockResolvedValue({ ...config });
	search.search.mockReset().mockImplementation(async () => ({ estimatedTotalHits: 0, hits: [] }));
});

function readList(collectionId: string, clerkUserId?: string) {
	requestHeaders.current = signedInHeaders(clerkUserId);
	return GET(new NextRequest(`https://library.example/api/user/items/${OWNER}?collectionId=${collectionId}`), {
		params: Promise.resolve({ id: OWNER }),
	});
}

function toggle(collectionId: string, itemKey: string, clerkUserId: string) {
	return toggleItem(new Request(`https://library.example/api/reader/collections/${collectionId}/items`, {
		method: "POST",
		headers: signedInHeaders(clerkUserId),
		body: JSON.stringify({ itemKey }),
	}), { params: Promise.resolve({ id: collectionId }) });
}

function leave(collectionId: string, clerkUserId: string, memberId: string) {
	return removeMember(new Request(`https://library.example/api/reader/collections/${collectionId}/members/${memberId}`, {
		method: "DELETE",
		headers: signedInHeaders(clerkUserId),
	}), { params: Promise.resolve({ id: collectionId, userId: memberId }) });
}

let share: (collectionId: string, role: ReaderCollectionRole) => Promise<unknown>;
let database: Database;

async function withCollections(
	verify: (collections: { emptyPrivate: string; savedPrivate: string; itemKey: string }) => Promise<void>,
) {
	await withIsolatedPublicationDatabase(async (db: Database) => {
		vi.mocked(getDatabase).mockResolvedValue(db);
		vi.mocked(getDatabaseForConfig).mockResolvedValue(db);
		await db.insert(readerUser).values({ id: OWNER, name: "Owner", email: "owner@example.org" });
		signedInHeaders = await signInReaders(db, config, [OWNER_CLERK_ID, OTHER_CLERK_ID]);
		// What accepting an invitation in OpenScholar leaves here.
		share = (collectionId, role) => db.insert(readerCollectionMember).values({ collectionId, userId: OTHER, role });
		database = db;
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

it("lists a private collection to someone it is shared with, and to nobody once they leave", async () => {
	await withCollections(async ({ savedPrivate, itemKey }) => {
		await share(savedPrivate, "viewer");
		expect((await readList(savedPrivate, OTHER_CLERK_ID)).status).toBe(200);
		expect(search.search.mock.lastCall?.[1].filter).toContainEqual(`key IN ["${itemKey}"]`);
		expect((await leave(savedPrivate, OTHER_CLERK_ID, OTHER)).status).toBe(204);
		expect((await readList(savedPrivate, OTHER_CLERK_ID)).status).toBe(403);
	});
});

it("lets an editor take records out and put them in, whoever added them, and refuses a viewer", async () => {
	await withCollections(async ({ savedPrivate, itemKey }) => {
		await share(savedPrivate, "viewer");
		expect((await toggle(savedPrivate, itemKey, OTHER_CLERK_ID)).status).toBe(404);
		// Only its owner takes someone else out.
		expect((await leave(savedPrivate, OTHER_CLERK_ID, OWNER)).status).toBe(404);
		await leave(savedPrivate, OWNER_CLERK_ID, OTHER);
		await share(savedPrivate, "editor");
		expect(await (await toggle(savedPrivate, itemKey, OTHER_CLERK_ID)).json()).toEqual({ inCollection: false });
		expect(await (await toggle(savedPrivate, itemKey, OTHER_CLERK_ID)).json()).toEqual({ inCollection: true });
	});
});

it("makes someone a member once per invitation, so accepting it again gives back nothing the owner changed or ended", async () => {
	await withCollections(async ({ savedPrivate, itemKey }) => {
		const join = (invitationId: string, role: ReaderCollectionRole, collectionId = savedPrivate) => joinCollection(database, invitationId, collectionId, OTHER, role);
		expect(await join("inv_first", "editor")).toEqual({ ownerId: OWNER });
		// A retry, as after a failed write, answers the same.
		expect(await join("inv_first", "editor")).toEqual({ ownerId: OWNER });
		await setCollectionMemberRole(database, OWNER, savedPrivate, OTHER, "viewer");
		await join("inv_first", "editor");
		expect((await toggle(savedPrivate, itemKey, OTHER_CLERK_ID)).status).toBe(404);
		await leave(savedPrivate, OWNER_CLERK_ID, OTHER);
		expect(await join("inv_first", "editor")).toEqual({ ended: true });
		expect((await readList(savedPrivate, OTHER_CLERK_ID)).status).toBe(403);
		// A newer invitation is the owner's newer decision.
		expect(await join("inv_second", "viewer")).toEqual({ ownerId: OWNER });
		expect((await readList(savedPrivate, OTHER_CLERK_ID)).status).toBe(200);
		expect(await join("inv_third", "viewer", "00000000-0000-4000-8000-000000000000")).toEqual({ gone: true });
	});
});

it("answers 404 for a collection that is not this reader's instead of listing the whole library", async () => {
	await withCollections(async () => {
		expect((await readList("00000000-0000-4000-8000-000000000000", OWNER_CLERK_ID)).status).toBe(404);
		expect((await readList("not-a-collection", OWNER_CLERK_ID)).status).toBe(404);
		expect(search.search).not.toHaveBeenCalled();
	});
});
