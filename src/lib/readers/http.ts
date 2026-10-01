import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { databaseErrorCode } from "@/db/transient-conflict";
import { featureUnavailableResponse } from "@/lib/runtime-feature";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";

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
	const config = await getLibraryConfig();
	if (!config.features.readerAccounts) return { response: featureUnavailableResponse() };
	const reader = await getSignedInReader(request.headers, config);
	if (!reader) return { response: readerError(401, "Sign in to continue.") };
	return { config, database: await getDatabaseForConfig(config), reader };
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
