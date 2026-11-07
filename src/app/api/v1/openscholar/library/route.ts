import { answerOpenScholar, readLibraryOverview } from "@/lib/openscholar/library-reads";

/** How many public records this library holds, the countries most of them are about, and its own collections with the public records each holds. */
export async function GET(request: Request) {
	return answerOpenScholar(request, "library", async ({ config, database }) => ({ body: await readLibraryOverview(config, database) }));
}
