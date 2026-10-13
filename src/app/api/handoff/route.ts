import { connection, NextResponse } from "next/server";
import { fromError } from "zod-validation-error";

import { getLibraryConfig } from "@/config/library-config/server";
import { handoffSchema } from "@/lib/openscholar/handoff";
import { createOpenScholarHandoff } from "@/lib/openscholar/handoff-server";
import { READER_RESPONSE_HEADERS, readJsonBody } from "@/lib/readers/http";
import { getSignedInOpenScholarUser } from "@/lib/readers/session";

/**
 * Hands records, a search or a collection to OpenScholar, and answers its address for the reader to open. Anyone may:
 * the hand-off holds no permission, and OpenScholar asks whoever opens it to sign in and reads it as them. The proxy
 * holds each visitor to the AI request windows (src/proxy.ts).
 */
export async function POST(request: Request) {
	await connection();
	const config = await getLibraryConfig();
	const handoff = handoffSchema.safeParse(await readJsonBody(request));
	if (!handoff.success) return NextResponse.json({ error: fromError(handoff.error).toString() }, { status: 400, headers: READER_RESPONSE_HEADERS });
	const reader = config.features.readerAccounts ? await getSignedInOpenScholarUser(request.headers, config) : null;
	try {
		return NextResponse.json({ url: await createOpenScholarHandoff(config, handoff.data, reader?.clerkUserId ?? null) }, { headers: READER_RESPONSE_HEADERS });
	} catch (error) {
		console.error("[library sources] a hand-off to OpenScholar failed", { from: handoff.data.from, error: String(error) });
		return NextResponse.json({ error: "OpenScholar didn't answer. Try again in a moment." }, { status: 502, headers: READER_RESPONSE_HEADERS });
	}
}
