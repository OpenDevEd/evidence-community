import { NextResponse } from "next/server";
import { z } from "zod";

import { READER_COLLECTION_ROLES, readerCollection } from "@/db/schema/tables/reader";
import { inviteToCollection } from "@/lib/readers/collection-invitations";
import { collectionAccess } from "@/lib/readers/data";
import { forOpenScholar, READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";
import { eq } from "drizzle-orm";

const bodySchema = z.object({ email: z.string().trim().toLowerCase().max(254), role: z.enum(READER_COLLECTION_ROLES) }).strict();

/** Invites someone to a collection by email. OpenScholar sends the invitation; owner only. */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const collectionId = (await props.params).id;
	const body = bodySchema.safeParse(await readJsonBody(request));
	if (!body.success) return readerError(400, "An email address and a role are required.");
	if ((await collectionAccess(access.database, access.reader.id, collectionId)) !== "owner") return readerError(404, "You have no such collection.");
	const [collection] = await access.database.select({ name: readerCollection.name }).from(readerCollection).where(eq(readerCollection.id, collectionId));
	if (!collection) return readerError(404, "You have no such collection.");
	return forOpenScholar(access, "Inviting to a collection", async (clerkUserId) =>
		NextResponse.json(
			await inviteToCollection(access.config.authentication.openScholar, {
				clerkUserId,
				collection: { id: collectionId, name: collection.name },
				...body.data,
			}),
			{ status: 201, headers: READER_RESPONSE_HEADERS },
		),
	);
}
