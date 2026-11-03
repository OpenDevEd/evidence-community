import type { NextRequest } from "next/server";
import { z } from "zod";

import { answerSourceRequest } from "@/lib/admin/openscholar-bearer";
import { trySubject } from "@/lib/readings/worker";

type Context = { params: Promise<{ key: string }> };

const REFUSED = {
	invalid_subject: { message: "Send the subject to try, up to 1,000 characters.", status: 400 },
	no_key: { message: "The community has no OpenRouter key to read records with.", status: 409 },
	not_found: { message: "No source has this key.", status: 404 },
} as const;

const trialSchema = z.object({ subject: z.string().trim().min(1).max(1_000) });

/**
 * Grades 200 of the source's records against a proposed subject and stores nothing: their grades now and with it, so
 * the owner can try a subject before saving it. Takes a minute or so.
 */
export function POST(request: NextRequest, { params }: Context) {
	return answerSourceRequest(request, params, REFUSED, async ({ config, database, key }) => {
		const body = trialSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) return "invalid_subject";
		const outcome = await trySubject(database, config, key, body.data.subject, request.signal);
		return typeof outcome === "object" ? { body: outcome, status: 200 } : outcome;
	});
}
