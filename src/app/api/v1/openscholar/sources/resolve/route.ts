import { answerOpenScholar, readerFor, refusals, resolveRequestSchema, resolveSource } from "@/lib/openscholar/library-reads";

/** A source of this library as record keys, for a job OpenScholar starts on it as `reader`: `{keys, total, truncated}`. */
export async function POST(request: Request) {
	return answerOpenScholar(request, "sources/resolve", async ({ config, database }) => {
		const parsed = resolveRequestSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) return refusals.invalid(parsed.error.issues.map((issue) => issue.message).join(" "));
		const readerId = await readerFor(config, database, parsed.data.reader);
		const resolved = await resolveSource(config, database, readerId, parsed.data, request.signal);
		return "error" in resolved ? resolved : { body: resolved };
	});
}
