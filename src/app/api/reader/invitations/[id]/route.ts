import { NextResponse } from "next/server";
import { z } from "zod";

import { READER_COLLECTION_ROLES } from "@/db/schema/tables/reader";
import { changeSentInvitation } from "@/lib/readers/collection-invitations";
import { forOpenScholar, READER_RESPONSE_HEADERS, readerError, readJsonBody, readReaderRequest } from "@/lib/readers/http";

type Props = { params: Promise<{ id: string }> };

const patchSchema = z.union([
	z.object({ role: z.enum(READER_COLLECTION_ROLES) }).strict(),
	z.object({ resend: z.literal(true) }).strict(),
]);

/** Changes the role a waiting invitation gives, or sends it again. Only its sender may. */
export async function PATCH(request: Request, props: Props) {
	const access = await readReaderRequest(request);
	if (access.response) return access.response;
	const change = patchSchema.safeParse(await readJsonBody(request));
	if (!change.success) return readerError(400, "Send a role, or ask to send the invitation again.");
	const { id } = await props.params;
	return forOpenScholar(access, "Changing a collection invitation", async (clerkUserId) => {
		await changeSentInvitation(access.config.authentication.openScholar, clerkUserId, id, change.data);
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
