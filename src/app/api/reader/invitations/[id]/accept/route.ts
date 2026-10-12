import { NextResponse } from "next/server";

import { acceptCollectionInvitation } from "@/lib/readers/collection-invitations";
import { addCollectionMember } from "@/lib/readers/data";
import { forOpenScholar, READER_RESPONSE_HEADERS, readerError, readReaderRequest } from "@/lib/readers/http";

/**
 * Accepts an invitation for the signed-in reader. OpenScholar checks their
 * account has the invited address; the library then makes them a member.
 * Accepting again changes nothing, so a retry after a failed write works.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const { id } = await props.params;
	return forOpenScholar(access, "Accepting a collection invitation", async (clerkUserId) => {
		const accepted = await acceptCollectionInvitation(access.config.authentication.openScholar, clerkUserId, id);
		const collection = await addCollectionMember(access.database, accepted.collectionId, access.reader.id, accepted.role);
		if (!collection) return readerError(410, "This collection was deleted.");
		return NextResponse.json({ ...accepted, ownerId: collection.ownerId }, { headers: READER_RESPONSE_HEADERS });
	});
}
