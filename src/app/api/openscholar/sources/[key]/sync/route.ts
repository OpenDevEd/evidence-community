import type { NextRequest } from "next/server";

import { answerSourceRequest } from "@/lib/admin/openscholar-bearer";
import { requestSourceRun } from "@/lib/source-ingestion/run-requests";

type Context = { params: Promise<{ key: string }> };

const REFUSED = {
	not_active: { message: "The source is paused or removed.", status: 409 },
	not_found: { message: "No imported source has this key.", status: 404 },
} as const;

/** Asks the source worker to import this source now, as after a fixed failure. */
export function POST(request: NextRequest, { params }: Context) {
	return answerSourceRequest(request, params, REFUSED, async ({ database, key }) => {
		const outcome = await requestSourceRun(database, key);
		return outcome === "requested" ? { body: { requested: true }, status: 202 } : outcome;
	});
}
