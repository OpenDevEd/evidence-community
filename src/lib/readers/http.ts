import "server-only";

import { connection, NextResponse } from "next/server";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { databaseErrorCode } from "@/db/transient-conflict";
import { featureUnavailableResponse } from "@/lib/runtime-feature";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";

import { invitationRefusal } from "./collection-invitations";
import { clerkUserIdOf, MAX_COLLECTIONS_PAGE_SIZE } from "./data";
import { getSignedInReader, type SignedInReader } from "./session";

export const READER_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

export function readerError(status: number, error: string) {
	return NextResponse.json({ error }, { status, headers: READER_RESPONSE_HEADERS });
}

type ReaderRequest =
	| { response: Response }
	| { response?: undefined; config: LibraryServerConfig; database: Database; reader: SignedInReader };

/** The signed-in reader and their library's database, or the response to send instead. */
export async function readReaderRequest(request: Request): Promise<ReaderRequest> {
	// Each answer belongs to one signed-in reader, so none is prerendered at build time.
	await connection();
	const config = await getLibraryConfig();
	if (!config.features.readerAccounts) return { response: featureUnavailableResponse() };
	const reader = await getSignedInReader(request.headers, config);
	if (!reader) return { response: readerError(401, "Sign in to continue.") };
	return { config, database: await getDatabaseForConfig(config), reader };
}

/** A page of a list of collections the address asks for: which page, and how many rows a page holds. */
export const pageQuerySchema = z.object({
	page: z.coerce.number().int().min(1).default(1),
	pageSize: z.coerce.number().int().min(1).max(MAX_COLLECTIONS_PAGE_SIZE),
});

/** The request's address parameters, read by `schema`. */
export function parseQuery<Query>(request: Request, schema: z.ZodType<Query>) {
	return schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
}

/** The signed-in reader's request, as `readReaderRequest` reads it, with its address parameters; or the response to send instead. */
export async function readReaderQuery<Query>(request: Request, schema: z.ZodType<Query>): Promise<{ response: Response } | (Exclude<ReaderRequest, { response: Response }> & { query: Query })> {
	const access = await readReaderRequest(request);
	if (access.response) return access;
	const query = parseQuery(request, schema);
	return query.success ? { ...access, query: query.data } : { response: readerError(400, fromError(query.error).toString()) };
}

/** The JSON body, or null when it is not JSON. */
export async function readJsonBody(request: Request): Promise<unknown> {
	return request.json().catch(() => null);
}

const recordKeyBodySchema = z.object({ itemKey: z.string().regex(/^[A-Z0-9]{8}$/u) }).strict();

/** Runs a change about one record named in the body; a record that does not exist answers 404. */
export async function changeForRecord(request: Request, change: (itemKey: string) => Promise<Response>) {
	const body = recordKeyBodySchema.safeParse(await readJsonBody(request));
	if (!body.success) return readerError(400, "A record key is required.");
	try {
		return await change(body.data.itemKey);
	} catch (error) {
		if (databaseErrorCode(error) === "23503") return readerError(404, "There is no such record.");
		throw error;
	}
}

/** What a reader is told when OpenScholar refuses an invitation change, by the code it refused with. */
const INVITATION_REFUSALS: Record<string, [number, string]> = {
	invalid_email: [400, "Enter a valid email address."],
	own_address: [400, "That's your own address."],
	rate_limited: [429, "You sent many invitations at once. Try again in a minute."],
	too_many_invitations: [409, "This person has too many invitations waiting."],
	not_found: [404, "This invitation is no longer open."],
	answered: [409, "This invitation was already answered."],
	expired: [410, "This invitation expired."],
	other_address: [403, "Sign in with the address the invitation was sent to."],
};

/**
 * Runs a call to OpenScholar about the signed-in reader, with the Clerk user
 * ID OpenScholar knows them by. Its refusals become the reader's errors;
 * anything else is logged and answered as OpenScholar being unreachable.
 */
export async function forOpenScholar(
	access: { database: Database; reader: SignedInReader; config: LibraryServerConfig },
	label: string,
	run: (clerkUserId: string) => Promise<Response>,
) {
	const clerkUserId = await clerkUserIdOf(access.database, access.reader.id);
	if (!clerkUserId) return readerError(401, "Sign in again to continue.");
	try {
		return await run(clerkUserId);
	} catch (error) {
		// Only a refusal the reader can act on is theirs; any other, such as a credential OpenScholar refused, is logged for whoever runs the library.
		const refusal = invitationRefusal(error);
		const known = refusal ? INVITATION_REFUSALS[refusal] : undefined;
		if (known) return NextResponse.json({ error: known[1], code: refusal }, { status: known[0], headers: READER_RESPONSE_HEADERS });
		console.error(`${label} failed`, { libraryId: access.config.authentication.openScholar.libraryId, readerId: access.reader.id, error });
		return readerError(503, "Openscholar can't be reached. Try again.");
	}
}
