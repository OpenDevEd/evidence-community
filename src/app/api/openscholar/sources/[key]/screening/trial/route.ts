import { connection, NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { trySubject } from "@/lib/readings/worker";

type Context = { params: Promise<{ key: string }> };

const REFUSED = {
	no_key: { message: "The library has no OpenRouter key to read records with.", status: 409 },
	not_found: { message: "No source has this key.", status: 404 },
} as const;

const trialSchema = z.object({ subject: z.string().trim().min(1).max(1_000) });

/**
 * Grades 200 of the source's records against a proposed subject and stores nothing: their grades now and with it, so
 * the owner can try a subject before saving it. Takes a minute or so.
 */
export async function POST(request: NextRequest, { params }: Context) {
	await connection();

	const config = await getLibraryConfig();
	const denied = await requireOpenScholarBearer(request, config.authentication.openScholar.machineCredential);
	if (denied) return denied;

	const body = trialSchema.safeParse(await request.json().catch(() => null));
	if (!body.success) {
		return NextResponse.json(
			{ error: { code: "invalid_subject", message: "Send the subject to try, up to 1,000 characters." } },
			{ headers: ADMIN_RESPONSE_HEADERS, status: 400 },
		);
	}
	try {
		const { key } = await params;
		const outcome = await trySubject(await getDatabaseForConfig(config), config, key, body.data.subject, request.signal);
		if (typeof outcome === "object") return NextResponse.json(outcome, { headers: ADMIN_RESPONSE_HEADERS });
		const { message, status } = REFUSED[outcome];
		return NextResponse.json({ error: { code: outcome, message } }, { headers: ADMIN_RESPONSE_HEADERS, status });
	} catch (error) {
		return adminErrorResponse(error);
	}
}
