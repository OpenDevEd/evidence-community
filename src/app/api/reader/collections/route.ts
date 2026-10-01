import { NextResponse } from "next/server";
import { fromError } from "zod-validation-error";

import { createReaderCollection, readerCollectionInputSchema } from "@/lib/readers/data";
import { READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";

export async function POST(request: Request) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const input = readerCollectionInputSchema.safeParse(await readJsonBody(request));
	if (!input.success) return readerError(400, fromError(input.error).toString());
	const collection = await createReaderCollection(access.database, access.reader.id, input.data);
	return NextResponse.json(collection, { status: 201, headers: READER_RESPONSE_HEADERS });
}
