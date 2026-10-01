import "server-only";

import { and, eq } from "drizzle-orm";
import { headers as requestHeaders } from "next/headers";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { readerAccount } from "@/db/schema/tables/reader";

import { getReaderAuthForConfig } from "./instance";
import { OPENSCHOLAR_PROVIDER_ID } from "./openscholar";

export type SignedInReader = { id: string; name: string; image: string | null };

/** The signed-in reader or admin, read from this request's session cookie. */
export async function getSignedInReader(
	headers?: Headers,
	config?: LibraryServerConfig,
): Promise<SignedInReader | null> {
	const { auth } = await getReaderAuthForConfig(config ?? (await getLibraryConfig()));
	const session = await auth.api.getSession({ headers: headers ?? (await requestHeaders()) });
	if (!session) return null;
	const { id, name, image } = session.user;
	return { id, name, image: image ?? null };
}

/**
 * The signed-in person with their Clerk user ID, which OpenScholar decides
 * admin roles by. The ID lives only on their OpenScholar account link, which
 * Better Auth writes from the token Clerk issued.
 */
export async function getSignedInOpenScholarUser(headers: Headers, config: LibraryServerConfig) {
	const reader = await getSignedInReader(headers, config);
	if (!reader) return null;
	const { database } = await getReaderAuthForConfig(config);
	const account = await database.query.readerAccount.findFirst({
		where: and(eq(readerAccount.userId, reader.id), eq(readerAccount.providerId, OPENSCHOLAR_PROVIDER_ID)),
		columns: { accountId: true },
	});
	return account ? { ...reader, clerkUserId: account.accountId } : null;
}
