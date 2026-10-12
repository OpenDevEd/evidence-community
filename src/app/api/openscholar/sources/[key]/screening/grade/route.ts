import type { NextRequest } from "next/server";
import { z } from "zod";

import { answerSourceRequest } from "@/lib/admin/openscholar-bearer";
import { requestGrading } from "@/lib/readings/screening";

type Context = { params: Promise<{ key: string }> };

const REFUSED = {
	no_key: { message: "The library has no OpenRouter key to read records with.", status: 409 },
	not_ready: { message: "The library is still applying this subject. Try again in a minute.", status: 409 },
	subject_changed: { message: "The source screens against another subject now. Ask again for that one.", status: 409 },
	not_screening: { message: "This source does not screen its records.", status: 409 },
} as const;

/** The subject the owner asked to grade against; a request without one takes the source's current subject. */
const gradeSchema = z.object({ subject: z.string().max(1_000).optional() }).catch({});

/**
 * Queues the source's records not graded against its current subject, as the owner asked: those it held before it
 * screened, or all of them after a new subject. Answers how many were queued.
 */
export function POST(request: NextRequest, { params }: Context) {
	return answerSourceRequest(request, params, REFUSED, async ({ config, database, key }) => {
		const { subject } = gradeSchema.parse(await request.json().catch(() => ({})));
		const outcome = await requestGrading(database, config, key, subject);
		return typeof outcome === "object" ? { body: outcome, status: 202 } : outcome;
	});
}
