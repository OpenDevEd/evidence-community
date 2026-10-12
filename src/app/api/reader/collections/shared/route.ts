import { NextResponse } from "next/server";

import { readSharedCollections } from "@/lib/readers/data";
import { pageQuerySchema, READER_RESPONSE_HEADERS, readReaderQuery } from "@/lib/readers/http";

/** A page of the collections other readers shared with the signed-in one, newest share first. */
export async function GET(request: Request) {
	const access = await readReaderQuery(request, pageQuerySchema);
	if (access.response) return access.response;
	return NextResponse.json(await readSharedCollections(access.database, access.reader.id, access.query), { headers: READER_RESPONSE_HEADERS });
}
