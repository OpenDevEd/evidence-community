import { connection, NextRequest, NextResponse } from "next/server";

import { getDatabase } from "@/db";
import { ADMIN_RESPONSE_HEADERS, adminErrorResponse } from "@/lib/admin/http";
import { requireOpenScholarBearer } from "@/lib/admin/openscholar-bearer";
import { requestSourceRun } from "@/lib/source-ingestion/run-requests";

type Context = { params: Promise<{ key: string }> };

const REFUSED = {
	not_active: { message: "The source is paused or removed.", status: 409 },
	not_found: { message: "No imported source has this key.", status: 404 },
} as const;

/** Asks the source worker to import this source now, as after a fixed failure. */
export async function POST(request: NextRequest, { params }: Context) {
	await connection();

	const denied = await requireOpenScholarBearer(request);
	if (denied) return denied;

	try {
		const { key } = await params;
		const outcome = await requestSourceRun(await getDatabase(), key);
		if (outcome === "requested") {
			return NextResponse.json({ requested: true }, { headers: ADMIN_RESPONSE_HEADERS, status: 202 });
		}
		const { message, status } = REFUSED[outcome];
		return NextResponse.json(
			{ error: { code: outcome, message } },
			{ headers: ADMIN_RESPONSE_HEADERS, status },
		);
	} catch (error) {
		return adminErrorResponse(error);
	}
}
