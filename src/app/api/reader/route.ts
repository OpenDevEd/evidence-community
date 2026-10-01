import { NextResponse } from "next/server";

import { readOwnReaderData } from "@/lib/readers/data";
import { READER_RESPONSE_HEADERS, readReaderRequest } from "@/lib/readers/http";

/** The signed-in reader's bookmarks and collections, for their own controls. */
export async function GET(request: Request) {
	const access = await readReaderRequest(request);
	if ("response" in access) return access.response;
	return NextResponse.json(await readOwnReaderData(access.database, access.reader.id), { headers: READER_RESPONSE_HEADERS });
}
