import { NextResponse } from "next/server";
import { fromError } from "zod-validation-error";

import { cancelCollectionInvitations } from "@/lib/readers/collection-invitations";
import { clerkUserIdOf, deleteReaderCollection, readerCollectionPatchSchema, updateReaderCollection } from "@/lib/readers/data";
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

/**
 * Deletes a collection the reader owns, and with it who it was shared with.
 * Its records stay bookmarked. Its waiting invitations are cancelled in
 * OpenScholar; one that can't be cancelled now finds no collection when it is
 * accepted, and expires within the week.
 */
export async function DELETE(request: Request, props: Props) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const collectionId = (await props.params).id;
	const deleted = await deleteReaderCollection(access.database, access.reader.id, collectionId);
	if (!deleted) return readerError(404, "You have no such collection.");
	const clerkUserId = await clerkUserIdOf(access.database, access.reader.id);
	if (clerkUserId) {
		await cancelCollectionInvitations(access.config.authentication.openScholar, clerkUserId, collectionId).catch((error: unknown) =>
			console.error("Cancelling a deleted collection's invitations failed", { readerId: access.reader.id, collectionId, error }),
		);
	}
	return new NextResponse(null, { status: 204, headers: READER_RESPONSE_HEADERS });
}
