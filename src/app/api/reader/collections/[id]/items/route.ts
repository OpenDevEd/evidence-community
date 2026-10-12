import { NextResponse } from "next/server";

import { toggleCollectionItem } from "@/lib/readers/data";
import { changeForRecord, READER_RESPONSE_HEADERS, readerError, readReaderRequest } from "@/lib/readers/http";

/** Puts a record into a collection the reader owns or edits, or takes it out. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const collectionId = (await props.params).id;
	return changeForRecord(request, async (itemKey) => {
		const result = await toggleCollectionItem(access.database, access.reader.id, collectionId, itemKey);
		return result
			? NextResponse.json(result, { headers: READER_RESPONSE_HEADERS })
			: readerError(404, "You have no such collection.");
	});
}
