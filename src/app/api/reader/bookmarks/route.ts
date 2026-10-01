import { NextResponse } from "next/server";

import { toggleBookmark } from "@/lib/readers/data";
import { changeForRecord, READER_RESPONSE_HEADERS, readReaderRequest } from "@/lib/readers/http";

/** Bookmarks a record, or removes the bookmark when it is there. */
export async function POST(request: Request) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	return changeForRecord(request, async (itemKey) =>
		NextResponse.json(await toggleBookmark(access.database, access.reader.id, itemKey), { headers: READER_RESPONSE_HEADERS }),
	);
}
