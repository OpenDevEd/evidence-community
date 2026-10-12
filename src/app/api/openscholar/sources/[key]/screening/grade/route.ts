import type { NextRequest } from "next/server";

import { answerSourceRequest } from "@/lib/admin/openscholar-bearer";
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
export function POST(request: NextRequest, { params }: Context) {
	return answerSourceRequest(request, params, REFUSED, async ({ config, database, key }) => {
		const outcome = await requestGrading(database, config, key);
		return typeof outcome === "object" ? { body: outcome, status: 202 } : outcome;
	});
}
