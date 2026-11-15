import { afterEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { handleOAuthUserInfo } from "better-auth/oauth2";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";
import { withIsolatedPublicationDatabase } from "../helpers/isolated-publication-database";

vi.mock("server-only", () => ({}));
vi.mock("@/db", () => ({ getDatabase: vi.fn(), getDatabaseForConfig: vi.fn() }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: vi.fn() }));
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
	// Reading a session schedules the account check after the response; the
	// background check has its own tests below.
	after: vi.fn(),
}));

import ProfilePage from "@/app/[locale]/profile/[id]/page";
import { GET as readOwnData } from "@/app/api/reader/route";
import { POST as toggleBookmarkRoute } from "@/app/api/reader/bookmarks/route";
import { POST as createCollectionRoute, GET as readPickerRoute } from "@/app/api/reader/collections/route";
import { GET as readCollectionsRoute } from "@/app/api/user/collections/[id]/route";
import { DELETE as deleteCollectionRoute, PATCH as editCollectionRoute } from "@/app/api/reader/collections/[id]/route";
import { POST as toggleCollectionItemRoute } from "@/app/api/reader/collections/[id]/items/route";
import { DELETE as deleteReaderRoute } from "@/app/api/v1/openscholar/readers/[clerkUserId]/route";
import { signInReaders } from "../helpers/reader-test-sessions";
import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import type { Database } from "@/db/database-schema";
import { readerAccount, readerBookmark, readerCollection, readerCollectionItem, readerSession, readerUser } from "@/db/schema/tables/reader";
import { createNativeItemDraft, publishItemDraft } from "@/lib/admin/native-item-service";
import { createReaderAuth, type ReaderAuth } from "@/lib/readers/auth";
import { getSignedInReader } from "@/lib/readers/session";
import { openScholarReader } from "@/lib/readers/openscholar";
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

/** Request headers signed in, through a real session, as one of the test's readers. */
let signedInHeaders: (clerkUserId?: string) => Headers = () => {
	throw new Error("Sign readers in inside withReaders");
};

async function withReaders(
	verify: (fixture: { db: Database; itemKey: string; amina: string; bob: string }) => Promise<void>,
) {
	await withIsolatedPublicationDatabase(async (db) => {
		vi.mocked(getDatabaseForConfig).mockResolvedValue(db);
		// A copy, so this database gets its own auth instance.
		vi.mocked(getLibraryConfig).mockResolvedValue({ ...config });
		// The test session names each reader after their Clerk user.
		const amina = "reader-user_amina";
		const bob = "reader-user_bob";
		await db.insert(readerUser).values([
			{ id: amina, name: "Amina Okafor", email: "amina@example.org" },
			{ id: bob, name: "", email: "bob@example.org" },
		]);
		await db.insert(readerAccount).values([
			{ id: "account-amina", userId: amina, providerId: "openscholar", accountId: "user_amina" },
			{ id: "account-bob", userId: bob, providerId: "openscholar", accountId: "user_bob" },
		]);
		signedInHeaders = await signInReaders(db, config, ["user_amina", "user_bob"]);
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

			const asVisitor = await readReaderProfile(db, amina, bob, { chosenId: null, pageSize: 6 });
			expect(asVisitor?.collections.rows.map((collection) => collection.name)).toEqual(["Shared"]);
			expect(JSON.stringify(asVisitor)).not.toContain("amina@example.org");
			const asOwner = await readReaderProfile(db, amina, amina, { chosenId: null, pageSize: 6 });
			expect(asOwner?.collections.rows.map((collection) => collection.name)).toEqual(["Shared", "Only mine"]);
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

			expect((await deleteRequest("user_amina")).status).toBe(401);
			expect((await deleteRequest("user_amina", `els_${"z".repeat(43)}`)).status).toBe(401);
			expect((await deleteRequest("user_amina", machineCredential)).status).toBe(204);
			expect((await deleteRequest("user_amina", machineCredential)).status).toBe(404);

			// Only Bob, his account link and his session remain.
			const keptForBob = new Set<unknown>([readerUser, readerAccount, readerSession]);
			for (const table of [readerUser, readerAccount, readerSession, readerBookmark, readerCollection, readerCollectionItem]) {
				const rows = await db.select({ count: sql<number>`count(*)::int` }).from(table);
				expect(rows[0]?.count, String(table)).toBe(keptForBob.has(table) ? 1 : 0);
			}
		});
	});
});

describe("signing in with OpenScholar", () => {
	it("gives another Clerk account with a reader's email its own reader, never theirs", async () => {
		await withReaders(async ({ db, amina }) => {
			const context = await createReaderAuth(config, db).$context;
			// Amina's address now belongs to a new Clerk account.
			const profile = { sub: "user_new", email: "amina@example.org", given_name: "New" };
			const result = await handleOAuthUserInfo({ context } as Parameters<typeof handleOAuthUserInfo>[0], {
				userInfo: { id: profile.sub, ...openScholarReader(profile) },
				account: { providerId: "openscholar", accountId: profile.sub },
				callbackURL: "/admin",
			});

			expect(result.error).toBeFalsy();
			expect(result.data?.user.id).not.toBe(amina);
			expect(await db.select({ accountId: readerAccount.accountId }).from(readerAccount).where(eq(readerAccount.userId, amina))).toEqual([
				{ accountId: "user_amina" },
			]);
		});
	});
});

describe("telling OpenScholar who signs in", () => {
	it("tells it on every sign-in, a new reader's first included", async () => {
		await withReaders(async ({ db }) => {
			const signedIn: string[] = [];
			const context = await createReaderAuth(config, db, undefined, (userId) => signedIn.push(userId)).$context;
			const profile = { sub: "user_first", email: "first@example.org", given_name: "First" };
			const result = await handleOAuthUserInfo({ context } as Parameters<typeof handleOAuthUserInfo>[0], {
				userInfo: { id: profile.sub, ...openScholarReader(profile) },
				account: { providerId: "openscholar", accountId: profile.sub },
				callbackURL: "/admin",
			});
			expect(signedIn).toEqual([result.data?.user.id]);
			// Sign-in matches by the address made from the Clerk ID; the real one is kept apart, for the review a reader sends.
			// Only Openscholar sets it: the reader can't write their own name, photo or email.
			const auth = createReaderAuth(config, db);
			const update = await auth.handler(new Request(`${config.identity.baseUrl}/api/auth/update-user`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contactEmail: "spoof@example.org" }) }));
			expect(update.status).toBe(404);
			expect(await db.select({ email: readerUser.email, contactEmail: readerUser.contactEmail }).from(readerUser).where(eq(readerUser.id, result.data!.user.id))).toEqual([
				{ email: "user_first@readers.openscholar.invalid", contactEmail: "first@example.org" },
			]);
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

			// It tells OpenScholar the reader was here, then asks after the account.
			expect(statusCalls).toEqual([
				{
					url: `${config.authentication.openScholar.convexSiteUrl}/api/v1/evidence-libraries/readers/seen`,
					body: { libraryId: config.authentication.openScholar.libraryId, clerkUserId: "user_amina" },
				},
				{
					url: `${config.authentication.openScholar.convexSiteUrl}/api/v1/evidence-libraries/reader-status`,
					body: { libraryId: config.authentication.openScholar.libraryId, clerkUserId: "user_amina" },
				},
			]);
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

			// The first check's report and status question; the second check is too soon to call at all.
			expect(fetcher).toHaveBeenCalledTimes(2);
			expect(await getSignedInReader(signedInHeaders("user_amina"), await getLibraryConfig())).toMatchObject({ id: amina });
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
			expect(await (await readOwnData(call("user_amina", "GET"))).json()).toEqual({ bookmarks: { [itemKey]: expect.any(String) } });
			const picker = await readPickerRoute(new Request(`https://library.example.org/api/reader/collections?pageSize=5&itemKey=${itemKey}`, { headers: signedInHeaders("user_amina") }));
			expect(await picker.json()).toMatchObject({
				rows: [{ id, name: "Coaching", description: "For the review", private: true, count: 1, holdsRecord: true }],
				total: 1,
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
	it("shows a visitor the reader's public collections, on the page and a page at a time, and no page for someone who is not a reader", async () => {
		await withReaders(async ({ db, amina }) => {
			await createReaderCollection(db, amina, { name: "Shared", description: null, private: false });
			await createReaderCollection(db, amina, { name: "Only mine", description: null, private: true });
			requestHeaders.current = signedInHeaders("user_bob");

			const page = (await ProfilePage({ params: Promise.resolve({ id: amina }), searchParams: Promise.resolve({}) })) as { props: { data: { name: string; collections: { rows: { name: string }[] } } } };
			expect(page.props.data.name).toBe("Amina Okafor");
			expect(page.props.data.collections.rows.map((collection) => collection.name)).toEqual(["Shared"]);
			await expect(ProfilePage({ params: Promise.resolve({ id: "reader-nobody" }), searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
			// The column turns its pages through this address, which answers by who is signed in.
			const pageAs = async (clerkUserId: string) => {
				const request = new Request(`https://library.example.org/api/user/collections/${amina}?pageSize=6`, { headers: signedInHeaders(clerkUserId) });
				const response = await readCollectionsRoute(request, { params: Promise.resolve({ id: amina }) });
				return ((await response.json()) as { rows: { name: string }[] }).rows.map((collection) => collection.name);
			};
			expect(await pageAs("user_bob")).toEqual(["Shared"]);
			expect(await pageAs("user_amina")).toEqual(["Shared", "Only mine"]);
		});
	});
});
