import { NextResponse } from "next/server";
import { z } from "zod";

import { databaseErrorCode } from "@/db/transient-conflict";
import { isItemKey, toggleBookmark } from "@/lib/readers/data";
import { READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";

const bodySchema = z.object({ itemKey: z.string().refine(isItemKey) }).strict();

/** Bookmarks a record, or removes the bookmark when it is there. */
export async function POST(request: Request) {
	const access = await readReaderRequest(request);
	if ("response" in access) return access.response;
	const body = bodySchema.safeParse(await readJsonBody(request));
	if (!body.success) return readerError(400, "A record key is required.");
	try {
		return NextResponse.json(await toggleBookmark(access.database, access.reader.id, body.data.itemKey), { headers: READER_RESPONSE_HEADERS });
	} catch (error) {
		if (databaseErrorCode(error) === "23503") return readerError(404, "There is no such record.");
		throw error;
	}
}
