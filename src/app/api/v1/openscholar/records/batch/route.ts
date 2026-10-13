import { answerOpenScholar, batchRequestSchema, readRecords, refusals } from "@/lib/openscholar/library-reads";

/** Public records by key, as OpenScholar reads them: `{records, unread}`. */
export async function POST(request: Request) {
	return answerOpenScholar(request, "records/batch", async ({ config }) => {
		const parsed = batchRequestSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) return refusals.invalid(parsed.error.issues.map((issue) => issue.message).join(" "));
		return { body: await readRecords(config, parsed.data.keys) };
	});
}
