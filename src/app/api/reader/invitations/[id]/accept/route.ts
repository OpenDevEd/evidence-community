import { NextResponse } from "next/server";

import { acceptCollectionInvitation } from "@/lib/readers/collection-invitations";
import { joinCollection } from "@/lib/readers/data";
import { forOpenScholar, READER_RESPONSE_HEADERS, readerError, readReaderRequest } from "@/lib/readers/http";

/**
 * Accepts an invitation for the signed-in reader. OpenScholar checks their
 * account has the invited address; the library then makes them a member.
 * Accepting again completes an acceptance whose write here failed, and never
 * gives back access the owner changed or ended since.
 */
export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const { id } = await props.params;
	return forOpenScholar(access, "Accepting a collection invitation", async (clerkUserId) => {
		const accepted = await acceptCollectionInvitation(access.config.authentication.openScholar, clerkUserId, id);
		const joined = await joinCollection(access.database, id, accepted.collectionId, access.reader.id, accepted.role);
		if ("gone" in joined) return readerError(410, "This collection was deleted.");
		if ("ended" in joined) return readerError(403, "Your access to this collection was ended. Ask its owner to invite you again.");
		return NextResponse.json({ ...accepted, ownerId: joined.ownerId }, { headers: READER_RESPONSE_HEADERS });
	});
}
