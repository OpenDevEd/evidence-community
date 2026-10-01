import { NextResponse } from "next/server";
import { z } from "zod";

import { databaseErrorCode } from "@/db/transient-conflict";
import { isItemKey, toggleCollectionItem } from "@/lib/readers/data";
import { READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";

const bodySchema = z.object({ itemKey: z.string().refine(isItemKey) }).strict();

/** Puts a record into one of the reader's own collections, or takes it out. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
	const access = await readReaderRequest(request);
	if ("response" in access) return access.response;
	const body = bodySchema.safeParse(await readJsonBody(request));
	if (!body.success) return readerError(400, "A record key is required.");
	try {
		const result = await toggleCollectionItem(access.database, access.reader.id, (await props.params).id, body.data.itemKey);
		if (!result) return readerError(404, "You have no such collection.");
		return NextResponse.json(result, { headers: READER_RESPONSE_HEADERS });
	} catch (error) {
		if (databaseErrorCode(error) === "23503") return readerError(404, "There is no such record.");
		throw error;
	}
}
