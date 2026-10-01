import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
vi.mock("@/lib/readers/session", () => import("../helpers/reader-session"));
vi.mock("next/navigation", () => ({
	notFound: () => {
		throw new Error("NEXT_NOT_FOUND");
	},
}));
// The page is checked for the data it hands over, not for its drawing.
vi.mock("@/components/pages/ReaderProfile", () => ({ default: () => null }));
vi.mock("@/app/[locale]/lib/page", () => ({ libraryMetadata: vi.fn() }));
const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: vi.fn(),
}));

import ProfilePage from "@/app/[locale]/profile/[id]/page";
import { GET as readOwnData } from "@/app/api/reader/route";
import { POST as toggleBookmarkRoute } from "@/app/api/reader/bookmarks/route";
import { POST as createCollectionRoute } from "@/app/api/reader/collections/route";
import { DELETE as deleteCollectionRoute, PATCH as editCollectionRoute } from "@/app/api/reader/collections/[id]/route";
import { POST as toggleCollectionItemRoute } from "@/app/api/reader/collections/[id]/items/route";
import { DELETE as deleteReaderRoute } from "@/app/api/v1/openscholar/readers/[clerkUserId]/route";
import { signedInHeaders } from "../helpers/reader-session";
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
		// The test session names each reader after their Clerk user.
		const amina = "reader-user_amina";
		const bob = "reader-user_bob";
		await db.insert(readerUser).values([
			{ id: amina, name: "Amina Okafor", email: "amina@example.org", clerkUserId: "user_amina" },
			{ id: bob, name: "", email: "bob@example.org", clerkUserId: "user_bob" },
		]);
		const { itemKey } = await createNativeItemDraft(db, { itemType: "Report", title: "Saved report" });
		await publishItemDraft(db, itemKey);
		await verify({ db, itemKey, amina, bob });
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

describe("reader routes", () => {
	function call(clerkUserId: string | undefined, method: string, body?: unknown) {
		const headers = signedInHeaders(clerkUserId);
		if (body) headers.set("Content-Type", "application/json");
		return new Request("https://library.example.org/api/reader", { method, headers, body: body ? JSON.stringify(body) : undefined });
	}
	const params = (id: string) => ({ params: Promise.resolve({ id }) });

	it("lets the signed-in reader bookmark and collect, and nobody else change their collections", async () => {
		await withReaders(async ({ itemKey }) => {
			expect((await toggleBookmarkRoute(call(undefined, "POST", { itemKey }))).status).toBe(401);
			expect(await (await toggleBookmarkRoute(call("user_amina", "POST", { itemKey }))).json()).toEqual({ bookmarked: true });
			expect((await toggleBookmarkRoute(call("user_amina", "POST", { itemKey: "NOSUCHAA" }))).status).toBe(404);

			const created = await createCollectionRoute(call("user_amina", "POST", { name: "Teacher training", description: "For the review", private: true }));
			expect(created.status).toBe(201);
			const { id } = (await created.json()) as { id: string };

			expect((await editCollectionRoute(call("user_bob", "PATCH", { name: "Taken" }), params(id))).status).toBe(404);
			expect((await toggleCollectionItemRoute(call("user_bob", "POST", { itemKey }), params(id))).status).toBe(404);
			expect((await deleteCollectionRoute(call("user_bob", "DELETE"), params(id))).status).toBe(404);

			expect((await editCollectionRoute(call("user_amina", "PATCH", { name: "Coaching" }), params(id))).status).toBe(200);
			expect(await (await toggleCollectionItemRoute(call("user_amina", "POST", { itemKey }), params(id))).json()).toEqual({ inCollection: true });
			const own = await (await readOwnData(call("user_amina", "GET"))).json();
			expect(own).toMatchObject({
				bookmarks: { [itemKey]: expect.any(String) },
				collections: [{ id, name: "Coaching", description: "For the review", private: true, count: 1 }],
				itemCollections: { [itemKey]: [id] },
			});
			expect((await deleteCollectionRoute(call("user_amina", "DELETE"), params(id))).status).toBe(204);
		});
	});

	it("answers 404 for every reader route when the library has reader accounts off", async () => {
		await withReaders(async ({ itemKey }) => {
			vi.mocked(getLibraryConfig).mockResolvedValue({ ...config, features: { ...config.features, readerAccounts: false } });
			expect((await toggleBookmarkRoute(call("user_amina", "POST", { itemKey }))).status).toBe(404);
			expect((await readOwnData(call("user_amina", "GET"))).status).toBe(404);
		});
	});
});

describe("profile page", () => {
	it("shows a visitor the reader's public collections and no page for someone who is not a reader", async () => {
		await withReaders(async ({ db, amina }) => {
			await createReaderCollection(db, amina, { name: "Shared", description: null, private: false });
			await createReaderCollection(db, amina, { name: "Only mine", description: null, private: true });
			requestHeaders.current = signedInHeaders("user_bob");

			const page = (await ProfilePage({ params: Promise.resolve({ id: amina }) })) as { props: { data: { name: string; collections: { name: string }[] } } };
			expect(page.props.data.name).toBe("Amina Okafor");
			expect(page.props.data.collections.map((collection) => collection.name)).toEqual(["Shared"]);
			await expect(ProfilePage({ params: Promise.resolve({ id: "reader-nobody" }) })).rejects.toThrow("NEXT_NOT_FOUND");
		});
	});
});
