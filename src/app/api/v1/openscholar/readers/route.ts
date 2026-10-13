import { answerOpenScholar } from "@/lib/openscholar/library-reads";
import { readOpenScholarReaders } from "@/lib/readers/data";

const PAGE = 500;

/** The OpenScholar accounts that signed in to this library, a page at a time: `{readers, next}`. */
export async function GET(request: Request) {
	return answerOpenScholar(request, "readers", async ({ config, database }) => {
		if (!config.features.readerAccounts) return { body: { readers: [], next: null } };
		const after = new URL(request.url).searchParams.get("cursor");
		return { body: await readOpenScholarReaders(database, after?.slice(0, 512) || null, PAGE) };
	});
}
