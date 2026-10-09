import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { testUtils } from "better-auth/plugins";
import { and, eq } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

import { readerAccount, readerSession, readerUser, readerVerification } from "../src/db/schema/tables/reader";
import { OPENSCHOLAR_PROVIDER_ID, openScholarReader } from "../src/lib/readers/openscholar";

/** What signs a library's sessions: its `authentication.secret`, and its `identity.baseUrl`, which decides the cookie names. */
type LibrarySessionSigning = { secret: string; libraryBaseUrl: string };

export type ReaderTestSessionTarget = LibrarySessionSigning & {
	/** The library's own database, reachable from where the test runs. */
	databaseUrl: string;
};

type ReaderOptions = { name?: string; cookieDomain?: string };

// Any library schema: only the reader tables are used.
type LibraryDatabase = NodePgDatabase<Record<string, unknown>>;

const databases = new Map<string, LibraryDatabase>();

/**
 * A real library session for this OpenScholar account, made the way the
 * library's own Better Auth makes one, without going through Clerk. For local
 * and acceptance tests only: it needs the library's database and secret.
 */
export async function mintReaderSessionCookies(target: ReaderTestSessionTarget, clerkUserId: string, options: ReaderOptions = {}) {
	let database = databases.get(target.databaseUrl);
	if (!database) {
		const opened = drizzle(target.databaseUrl);
		// The pool outlives the test stack: when its database stops, the idle
		// connection's termination must not end the process. The next query reconnects.
		opened.$client.on("error", () => {});
		database = opened;
		databases.set(target.databaseUrl, database);
	}
	return mintReaderSessionCookiesIn(database, target, clerkUserId, options);
}

/** The same, on a database the test already holds. */
export async function mintReaderSessionCookiesIn(
	database: LibraryDatabase,
	signing: LibrarySessionSigning,
	clerkUserId: string,
	options: ReaderOptions = {},
) {
	const auth = betterAuth({
		baseURL: signing.libraryBaseUrl,
		secret: signing.secret,
		database: drizzleAdapter(database, {
			provider: "pg",
			schema: { user: readerUser, session: readerSession, account: readerAccount, verification: readerVerification },
		}),
		advanced: { cookiePrefix: "evidence-library" },
		plugins: [testUtils()],
	});
	await database
		.insert(readerUser)
		.values({
			...openScholarReader({ sub: clerkUserId }),
			id: `reader-${clerkUserId}`,
			name: options.name ?? "Acceptance reader",
			image: null,
		})
		.onConflictDoNothing();
	await database
		.insert(readerAccount)
		.values({ id: `account-${clerkUserId}`, userId: `reader-${clerkUserId}`, providerId: OPENSCHOLAR_PROVIDER_ID, accountId: clerkUserId })
		.onConflictDoNothing();
	// The account may already belong to a reader who signed in for real.
	const [account] = await database
		.select({ userId: readerAccount.userId })
		.from(readerAccount)
		.where(and(eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID), eq(readerAccount.accountId, clerkUserId)));
	if (!account) throw new Error(`No reader for ${clerkUserId}`);
	const { test } = await auth.$context;
	const cookies = await test.getCookies({
		userId: account.userId,
		domain: options.cookieDomain ?? new URL(signing.libraryBaseUrl).hostname,
	});
	return { readerId: account.userId, cookies };
}

export function cookieHeader(cookies: { name: string; value: string }[]) {
	return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
