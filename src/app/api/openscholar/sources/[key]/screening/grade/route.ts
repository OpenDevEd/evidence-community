import type { NextRequest } from "next/server";
import { z } from "zod";

import { answerSourceRequest } from "@/lib/admin/openscholar-bearer";
import { requestGrading } from "@/lib/readings/screening";

type Context = { params: Promise<{ key: string }> };

const REFUSED = {
	invalid_subject: { message: "Send the subject to grade against as a string of up to 1,000 characters, or no body.", status: 400 },
	no_key: { message: "The community has no OpenRouter key to read records with.", status: 409 },
	not_ready: { message: "The community is still applying this subject. Try again in a minute.", status: 409 },
	subject_changed: { message: "The source screens against another subject now. Ask again for that one.", status: 409 },
	not_screening: { message: "This source does not screen its records.", status: 409 },
} as const;

/** The subject the owner asked to grade against; a request with no body takes the source's current subject. */
const gradeSchema = z.object({ subject: z.string().trim().min(1).max(1_000).optional() });

/** The asked subject, undefined for no body, or null for a body that says nothing usable, which is refused. */
async function askedSubject(request: Request) {
	const text = await request.text();
	if (!text.trim()) return undefined;
	try {
		const parsed = gradeSchema.safeParse(JSON.parse(text));
		return parsed.success ? parsed.data.subject : null;
	} catch {
		return null;
	}
}

/**
 * Queues the source's records not graded against its current subject, as the owner asked: those it held before it
 * screened, or all of them after a new subject. Answers how many were queued.
 */
export function POST(request: NextRequest, { params }: Context) {
	return answerSourceRequest(request, params, REFUSED, async ({ config, database, key }) => {
		const subject = await askedSubject(request);
		if (subject === null) return "invalid_subject";
		const outcome = await requestGrading(database, config, key, subject);
		return typeof outcome === "object" ? { body: outcome, status: 202 } : outcome;
	});
}
