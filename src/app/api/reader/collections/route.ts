import { NextResponse } from "next/server";
import { z } from "zod";
import { fromError } from "zod-validation-error";

import { createReaderCollection, readerCollectionInputSchema, readPickerCollections } from "@/lib/readers/data";
import { pageQuerySchema, READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderQuery, readReaderRequest } from "@/lib/readers/http";

const querySchema = pageQuerySchema.extend({
	search: z.string().max(200).default(""),
	sort: z.enum(["recent", "name"]).default("recent"),
	itemKey: z
		.string()
		.regex(/^[A-Z0-9]{8}$/u)
		.nullable()
		.default(null),
});

/** A page of the collections a record can go into, each saying whether it holds the record. */
export async function GET(request: Request) {
	const access = await readReaderQuery(request, querySchema);
	if (access.response) return access.response;
	return NextResponse.json(await readPickerCollections(access.database, access.reader.id, access.query), { headers: READER_RESPONSE_HEADERS });
}

export async function POST(request: Request) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const input = readerCollectionInputSchema.safeParse(await readJsonBody(request));
	if (!input.success) return readerError(400, fromError(input.error).toString());
	const collection = await createReaderCollection(access.database, access.reader.id, input.data);
	return NextResponse.json(collection, { status: 201, headers: READER_RESPONSE_HEADERS });
}
