import { fromError } from "zod-validation-error";

import { answerOpenScholar, matchRecords, matchRequestSchema, refusals } from "@/lib/openscholar/library-reads";

/** The records this library holds for papers OpenScholar names by their OpenAlex ID or DOI, up to 500 at a time. */
export async function POST(request: Request) {
	return answerOpenScholar(request, "records/match", async ({ config, database }) => {
		const body = matchRequestSchema.safeParse(await request.json().catch(() => null));
		if (!body.success) return refusals.invalid(fromError(body.error).toString());
		return { body: { matches: await matchRecords(config, database, body.data.papers) } };
	});
}
