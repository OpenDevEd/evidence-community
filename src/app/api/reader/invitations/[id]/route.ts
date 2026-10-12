import { NextResponse } from "next/server";
import { z } from "zod";

import { READER_COLLECTION_ROLES } from "@/db/schema/tables/reader";
import type { Database } from "@/db/database-schema";
import { changeSentInvitation } from "@/lib/readers/collection-invitations";
import { ownedCollectionName } from "@/lib/readers/data";
import { forOpenScholar, READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";

type Props = { params: Promise<{ id: string }> };

const patchSchema = z.union([
	z.object({ role: z.enum(READER_COLLECTION_ROLES) }).strict(),
	z.object({ resend: z.literal(true), collectionId: z.uuid() }).strict(),
]);

/** A change as OpenScholar takes it: sending again carries the name the reader's collection has now. Null when they own no such collection. */
async function withCollectionName(database: Database, readerId: string, change: z.infer<typeof patchSchema>) {
	if (!("resend" in change)) return change;
	const collectionName = await ownedCollectionName(database, readerId, change.collectionId);
	return collectionName === null ? null : { ...change, collectionName };
}

/** Changes the role a waiting invitation gives, or sends it again. Only its sender may. */
export async function PATCH(request: Request, props: Props) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const parsed = patchSchema.safeParse(await readJsonBody(request));
	if (!parsed.success) return readerError(400, "Send a role, or ask to send the invitation again.");
	const change = await withCollectionName(access.database, access.reader.id, parsed.data);
	if (!change) return readerError(404, "You have no such collection.");
	const { id } = await props.params;
	return forOpenScholar(access, "Changing a collection invitation", async (clerkUserId) => {
		await changeSentInvitation(access.config.authentication.openScholar, clerkUserId, id, change);
		return new NextResponse(null, { status: 204, headers: READER_RESPONSE_HEADERS });
	});
}

/** Cancels a waiting invitation. Only its sender may. */
export async function DELETE(request: Request, props: Props) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const { id } = await props.params;
	return forOpenScholar(access, "Cancelling a collection invitation", async (clerkUserId) => {
		await changeSentInvitation(access.config.authentication.openScholar, clerkUserId, id, { cancel: true });
		return new NextResponse(null, { status: 204, headers: READER_RESPONSE_HEADERS });
	});
}
