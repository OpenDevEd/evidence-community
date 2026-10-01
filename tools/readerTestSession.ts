import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { testUtils } from "better-auth/plugins";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";

import { readerAccount, readerSession, readerUser, readerVerification } from "../src/db/schema/tables/reader";

/** The library keeps a reader's Clerk user ID on their OpenScholar account link. */
const OPENSCHOLAR_PROVIDER_ID = "openscholar";

export type ReaderTestSessionTarget = {
	/** The library's own database, reachable from where the test runs. */
	databaseUrl: string;
	/** The library's `authentication.secret`, which signs its session cookies. */
	secret: string;
	/** The library's `identity.baseUrl`; it decides the cookie's name and Secure flag. */
	libraryBaseUrl: string;
};

const instances = new Map<string, ReturnType<typeof createTestAuth>>();

function createTestAuth(target: ReaderTestSessionTarget) {
	const database = drizzle(target.databaseUrl);
	return {
		database,
		auth: betterAuth({
			baseURL: target.libraryBaseUrl,
			secret: target.secret,
			database: drizzleAdapter(database, {
				provider: "pg",
				schema: { user: readerUser, session: readerSession, account: readerAccount, verification: readerVerification },
			}),
			advanced: { cookiePrefix: "evidence-library" },
			plugins: [testUtils()],
		}),
	};
}

/**
 * A real library session for this OpenScholar account, made the way the
 * library's own Better Auth makes one, without going through Clerk. For local
 * and acceptance tests only: it needs the library's database and secret.
 */
export async function mintReaderSessionCookies(
	target: ReaderTestSessionTarget,
	clerkUserId: string,
	options: { name?: string; cookieDomain?: string } = {},
) {
	const key = `${target.databaseUrl}|${target.libraryBaseUrl}`;
	let instance = instances.get(key);
	if (!instance) {
		instance = createTestAuth(target);
		instances.set(key, instance);
	}
	const { auth, database } = instance;
	const readerId = `reader-${clerkUserId}`;
	await database
		.insert(readerUser)
		.values({ id: readerId, name: options.name ?? "Acceptance reader", email: `${clerkUserId}@acceptance.example.org`, emailVerified: true })
		.onConflictDoNothing();
	await database
		.insert(readerAccount)
		.values({ id: `account-${clerkUserId}`, userId: readerId, providerId: OPENSCHOLAR_PROVIDER_ID, accountId: clerkUserId })
		.onConflictDoNothing();
	const [reader] = await database.select({ id: readerUser.id }).from(readerUser).where(eq(readerUser.id, readerId));
	if (!reader) throw new Error(`No reader for ${clerkUserId}`);
	const { test } = await auth.$context;
	const cookies = await test.getCookies({
		userId: reader.id,
		domain: options.cookieDomain ?? new URL(target.libraryBaseUrl).hostname,
	});
	return { readerId: reader.id, cookies };
}

export function cookieHeader(cookies: { name: string; value: string }[]) {
	return cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
