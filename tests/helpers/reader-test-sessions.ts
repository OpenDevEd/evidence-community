import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";

import { cookieHeader, mintReaderSessionCookiesIn } from "../../tools/readerTestSession";

/**
 * Real Better Auth sessions for these Clerk users, made with its test
 * utilities in the library's database. Returns request headers signed in as
 * one of them, or signed out.
 */
export async function signInReaders(database: Database, config: LibraryServerConfig, clerkUserIds: string[]) {
	const sessions = new Map<string, string>();
	const signing = { secret: config.authentication.secret, libraryBaseUrl: config.identity.baseUrl };
	for (const clerkUserId of clerkUserIds) {
		const { cookies } = await mintReaderSessionCookiesIn(database, signing, clerkUserId);
		sessions.set(clerkUserId, cookieHeader(cookies));
	}
	return (clerkUserId?: string) => {
		const headers = new Headers();
		if (!clerkUserId) return headers;
		const cookie = sessions.get(clerkUserId);
		if (!cookie) throw new Error(`No test session for ${clerkUserId}`);
		headers.set("cookie", cookie);
		return headers;
	};
}
