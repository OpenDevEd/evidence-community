import { connection, NextRequest, NextResponse } from "next/server";

import { getLibraryConfig } from "@/config/library-config/server";
import { getDatabaseForConfig } from "@/db";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { requestGrading } from "@/lib/readings/screening";

type Context = { params: Promise<{ key: string }> };

const REFUSED = {
	no_key: { message: "The library has no OpenRouter key to read records with.", status: 409 },
	not_screening: { message: "This source does not screen its records.", status: 409 },
} as const;

/**
 * Queues the source's records not graded against its current subject, as the owner asked: those it held before it
 * screened, or all of them after a new subject. Answers how many were queued.
 */
export async function POST(request: NextRequest, { params }: Context) {
	await connection();

	// One configuration revision authorises the call and holds the request.
	const config = await getLibraryConfig();
	const denied = await requireOpenScholarBearer(request, config.authentication.openScholar.machineCredential);
	if (denied) return denied;

	try {
		const { key } = await params;
		const outcome = await requestGrading(await getDatabaseForConfig(config), config, key);
		if (typeof outcome === "object") return NextResponse.json(outcome, { headers: ADMIN_RESPONSE_HEADERS, status: 202 });
		const { message, status } = REFUSED[outcome];
		return NextResponse.json({ error: { code: outcome, message } }, { headers: ADMIN_RESPONSE_HEADERS, status });
	} catch (error) {
		return adminErrorResponse(error);
	}
}
