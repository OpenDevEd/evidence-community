import { NextResponse } from "next/server";
import { fromError } from "zod-validation-error";

import { deleteReaderCollection, readerCollectionPatchSchema, updateReaderCollection } from "@/lib/readers/data";
import { READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";

type Props = { params: Promise<{ id: string }> };

/** Renames a collection, changes its description or makes it private or public. Owner only. */
export async function PATCH(request: Request, props: Props) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const patch = readerCollectionPatchSchema.safeParse(await readJsonBody(request));
	if (!patch.success) return readerError(400, fromError(patch.error).toString());
	const updated = await updateReaderCollection(access.database, access.reader.id, (await props.params).id, patch.data);
	if (!updated) return readerError(404, "You have no such collection.");
	return NextResponse.json(updated, { headers: READER_RESPONSE_HEADERS });
}

/** Deletes a collection the reader owns. Its records stay bookmarked. */
export async function DELETE(request: Request, props: Props) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const deleted = await deleteReaderCollection(access.database, access.reader.id, (await props.params).id);
	if (!deleted) return readerError(404, "You have no such collection.");
	return new NextResponse(null, { status: 204, headers: READER_RESPONSE_HEADERS });
}
