import { NextResponse } from "next/server";
import { z } from "zod";

import { READER_COLLECTION_ROLES } from "@/db/schema/tables/reader";
import { inviteToCollection } from "@/lib/readers/collection-invitations";
import { ownedCollectionName } from "@/lib/readers/data";
import { forOpenScholar, READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().max(254), role: z.enum(READER_COLLECTION_ROLES) }).strict();

/** Invites someone to a collection by email. OpenScholar sends the invitation; owner only. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const collectionId = (await props.params).id;
	const body = bodySchema.safeParse(await readJsonBody(request));
	if (!body.success) return readerError(400, "An email address and a role are required.");
	const name = await ownedCollectionName(access.database, access.reader.id, collectionId);
	if (name === null) return readerError(404, "You have no such collection.");
	return forOpenScholar(access, "Inviting to a collection", async (clerkUserId) =>
		NextResponse.json(
			await inviteToCollection(access.config.authentication.openScholar, { clerkUserId, collection: { id: collectionId, name }, ...body.data }),
			{ status: 201, headers: READER_RESPONSE_HEADERS },
		),
	);
}
