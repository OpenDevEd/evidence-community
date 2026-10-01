import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));

import { DELETE as deleteReaderRoute } from "@/app/api/v1/openscholar/readers/[clerkUserId]/route";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { readerBookmark, readerCollection, readerCollectionItem, readerSession, readerUser } from "@/db/schema/tables/reader";
import { createNativeItemDraft, publishItemDraft } from "@/lib/admin/native-item-service";
import type { ReaderAuth } from "@/lib/readers/auth";
import { checkReaderSoon, READER_CHECK_INTERVAL_MS } from "@/lib/readers/check";
import {
	createReaderCollection,
	deleteReaderCollection,
	readReaderProfile,
	toggleBookmark,
	toggleCollectionItem,
	updateReaderCollection,
} from "@/lib/readers/data";

const config = libraryConfigSchema.parse(maximalLibraryConfig);
const machineCredential = config.authentication.openScholar.machineCredential;

afterEach(() => vi.unstubAllGlobals());

async function withReaders(
	verify: (fixture: { db: Database; itemKey: string; amina: string; bob: string }) => Promise<void>,
) {
	await withIsolatedPublicationDatabase(async (db) => {
		vi.mocked(getDatabaseForConfig).mockResolvedValue(db);
		vi.mocked(getLibraryConfig).mockResolvedValue(config);
		await db.insert(readerUser).values([
			{ id: "amina", name: "Amina Okafor", email: "amina@example.org", clerkUserId: "user_amina" },
			{ id: "bob", name: "", email: "bob@example.org", clerkUserId: "user_bob" },
		]);
		const { itemKey } = await createNativeItemDraft(db, { itemType: "Report", title: "Saved report" });
		await publishItemDraft(db, itemKey);
		await verify({ db, itemKey, amina: "amina", bob: "bob" });
	});
}

describe("reader collections", () => {
	it("lets only the owner rename, delete or fill a collection", async () => {
		await withReaders(async ({ db, itemKey, amina, bob }) => {
			const { id } = await createReaderCollection(db, amina, { name: "Teacher training", description: null, private: true });

			expect(await updateReaderCollection(db, bob, id, { name: "Taken over" })).toBeNull();
			expect(await toggleCollectionItem(db, bob, id, itemKey)).toBeNull();
			expect(await deleteReaderCollection(db, bob, id)).toBe(false);
			const [untouched] = await db.select().from(readerCollection).where(eq(readerCollection.id, id));
			expect(untouched?.name).toBe("Teacher training");
			expect(await db.select().from(readerCollectionItem)).toEqual([]);

			expect(await updateReaderCollection(db, amina, id, { name: "Coaching", private: false })).toEqual({ id });
			expect(await toggleCollectionItem(db, amina, id, itemKey)).toEqual({ inCollection: true });
			expect(await toggleCollectionItem(db, amina, id, itemKey)).toEqual({ inCollection: false });
			expect(await deleteReaderCollection(db, amina, id)).toBe(true);
		});
	});

	it("shows a reader's private collections only on their own profile, and never their email", async () => {
		await withReaders(async ({ db, amina, bob }) => {
			await createReaderCollection(db, amina, { name: "Shared", description: "For the team", private: false });
			await createReaderCollection(db, amina, { name: "Only mine", description: null, private: true });

			const asVisitor = await readReaderProfile(db, amina, bob);
			expect(asVisitor?.collections.map((collection) => collection.name)).toEqual(["Shared"]);
			expect(JSON.stringify(asVisitor)).not.toContain("amina@example.org");
			const asOwner = await readReaderProfile(db, amina, amina);
			expect(asOwner?.collections.map((collection) => collection.name)).toEqual(["Shared", "Only mine"]);
		});
	});

	it("bookmarks a record, then removes the bookmark", async () => {
		await withReaders(async ({ db, itemKey, amina }) => {
			expect(await toggleBookmark(db, amina, itemKey)).toEqual({ bookmarked: true });
			expect(await toggleBookmark(db, amina, itemKey)).toEqual({ bookmarked: false });
			expect(await db.select().from(readerBookmark)).toEqual([]);
		});
	});
});

describe("deleting an OpenScholar account", () => {
	function deleteRequest(clerkUserId: string, credential?: string) {
		return deleteReaderRoute(
			new Request(`https://library.example.org/api/v1/openscholar/readers/${clerkUserId}`, {
				method: "DELETE",
				headers: credential ? { Authorization: `Bearer ${credential}` } : {},
			}),
			{ params: Promise.resolve({ clerkUserId }) },
		);
	}

	it("removes the reader and everything kept for them only for OpenScholar's own credential", async () => {
		await withReaders(async ({ db, itemKey, amina }) => {
			await toggleBookmark(db, amina, itemKey);
			const { id } = await createReaderCollection(db, amina, { name: "Mine", description: null, private: true });
			await toggleCollectionItem(db, amina, id, itemKey);
			await db.insert(readerSession).values({ id: "session-1", token: "token-1", userId: amina, expiresAt: new Date(Date.now() + 60_000) });

			expect((await deleteRequest("user_amina")).status).toBe(401);
			expect((await deleteRequest("user_amina", `els_${"z".repeat(43)}`)).status).toBe(401);
			expect((await deleteRequest("user_amina", machineCredential)).status).toBe(204);
			expect((await deleteRequest("user_amina", machineCredential)).status).toBe(404);

			for (const table of [readerUser, readerSession, readerBookmark, readerCollection, readerCollectionItem]) {
				const rows = await db.select({ count: sql<number>`count(*)::int` }).from(table);
				expect(rows[0]?.count, String(table)).toBe(table === readerUser ? 1 : 0);
			}
		});
	});
});

describe("the background account check", () => {
	function fakeAuth(getAccessToken: () => Promise<{ accessToken: string }>) {
		return { api: { getAccessToken } } as unknown as ReaderAuth;
	}

	async function makeCheckDue(db: Database, userId: string) {
		await db.update(readerUser).set({ checkedAt: new Date(Date.now() - READER_CHECK_INTERVAL_MS - 1_000) }).where(eq(readerUser.id, userId));
	}

	it("removes a reader whose refresh fails only when OpenScholar says the account was deleted", async () => {
		await withReaders(async ({ db, amina }) => {
			await makeCheckDue(db, amina);
			const statusCalls: unknown[] = [];
			vi.stubGlobal("fetch", vi.fn(async (url: URL | string, init?: RequestInit) => {
				statusCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
				return Response.json({ status: "deleted" });
			}));
			await checkReaderSoon({ auth: fakeAuth(async () => { throw new Error("Failed to get a valid access token"); }), config, database: db, userId: amina });

			expect(statusCalls).toEqual([{
				url: `${config.authentication.openScholar.convexSiteUrl}/api/v1/evidence-libraries/reader-status`,
				body: { libraryId: config.authentication.openScholar.libraryId, clerkUserId: "user_amina" },
			}]);
			expect(await db.select().from(readerUser).where(eq(readerUser.id, amina))).toEqual([]);
		});
	});

	it("keeps the session when OpenScholar cannot be reached, and checks again only after 15 minutes", async () => {
		await withReaders(async ({ db, amina }) => {
			await makeCheckDue(db, amina);
			const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
			vi.stubGlobal("fetch", fetcher);
			vi.spyOn(console, "warn").mockImplementation(() => undefined);
			const failingAuth = fakeAuth(async () => { throw new Error("Failed to get a valid access token"); });

			await checkReaderSoon({ auth: failingAuth, config, database: db, userId: amina });
			await checkReaderSoon({ auth: failingAuth, config, database: db, userId: amina });

			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(await db.select({ id: readerUser.id }).from(readerUser).where(eq(readerUser.id, amina))).toEqual([{ id: amina }]);
		});
	});
});
