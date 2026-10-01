import "server-only";

import { headers as requestHeaders } from "next/headers";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";

import { getReaderAuthForConfig } from "./auth";

export type SignedInReader = { id: string; name: string; image: string | null; clerkUserId: string };

/** The signed-in reader or admin, read from this request's session cookie. */
export async function getSignedInReader(
	headers?: Headers,
	config?: LibraryServerConfig,
): Promise<SignedInReader | null> {
	const { auth } = await getReaderAuthForConfig(config ?? (await getLibraryConfig()));
	const session = await auth.api.getSession({ headers: headers ?? (await requestHeaders()) });
	if (!session) return null;
	const { id, name, image, clerkUserId } = session.user;
	return { id, name, image: image ?? null, clerkUserId };
}
