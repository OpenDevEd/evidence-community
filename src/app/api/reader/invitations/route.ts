import { NextResponse } from "next/server";

import { listSentInvitations } from "@/lib/readers/collection-invitations";
import { forOpenScholar, READER_RESPONSE_HEADERS, readReaderRequest } from "@/lib/readers/http";

/** The invitations the reader sent that still wait for an answer, to all their collections. */
export async function GET(request: Request) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	return forOpenScholar(access, "Listing collection invitations", async (clerkUserId) =>
		NextResponse.json(
			{ invitations: await listSentInvitations(access.config.authentication.openScholar, clerkUserId) },
			{ headers: READER_RESPONSE_HEADERS },
		),
	);
}
