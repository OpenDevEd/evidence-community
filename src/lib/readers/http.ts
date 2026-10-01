import "server-only";

import { NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { featureUnavailableResponse } from "@/lib/runtime-feature";

import { getSignedInReader } from "./session";

export const READER_RESPONSE_HEADERS = { "Cache-Control": "private, no-store" };

export function readerError(status: number, error: string) {
	return NextResponse.json({ error }, { status, headers: READER_RESPONSE_HEADERS });
}

/** The signed-in reader and their library's database, or the response to send instead. */
export async function readReaderRequest(request: Request) {
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
