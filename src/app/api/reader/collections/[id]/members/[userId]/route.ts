import { NextResponse } from "next/server";
import { z } from "zod";

import { READER_COLLECTION_ROLES } from "@/db/schema/tables/reader";
import { removeCollectionMember, setCollectionMemberRole } from "@/lib/readers/data";
import { READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";

type Props = { params: Promise<{ id: string; userId: string }> };

const patchSchema = z.object({ role: z.enum(READER_COLLECTION_ROLES) }).strict();

/** Changes what a member may do. Owner only. */
export async function PATCH(request: Request, props: Props) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const patch = patchSchema.safeParse(await readJsonBody(request));
	if (!patch.success) return readerError(400, "A role is required.");
	const { id, userId } = await props.params;
	const changed = await setCollectionMemberRole(access.database, access.reader.id, id, userId, patch.data.role);
	if (!changed) return readerError(404, "There is no such member.");
	return new NextResponse(null, { status: 204, headers: READER_RESPONSE_HEADERS });
}

/** The owner takes someone out of the collection, or a member leaves it. */
export async function DELETE(request: Request, props: Props) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const { id, userId } = await props.params;
	const removed = await removeCollectionMember(access.database, access.reader.id, id, userId);
	if (!removed) return readerError(404, "There is no such member.");
	return new NextResponse(null, { status: 204, headers: READER_RESPONSE_HEADERS });
}
