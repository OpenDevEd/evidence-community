import { answerOpenScholar, readerFor, refusals } from "@/lib/openscholar/library-reads";
import { MAX_COLLECTIONS_PAGE_SIZE, readProfileCollections, readSharedCollections } from "@/lib/readers/data";

/**
 * A page of a person's collections here: `list=own` their own, private ones too, oldest first; `list=shared` the
 * ones shared with them, newest share first. Empty for someone who never signed in to this library.
 */
export async function GET(request: Request, props: { params: Promise<{ clerkUserId: string }> }) {
	return answerOpenScholar(request, "readers/collections", async ({ config, database }) => {
		if (!config.features.readerAccounts) return refusals.readerAccountsOff;
		const params = new URL(request.url).searchParams;
		const list = params.get("list") ?? "own";
		if (list !== "own" && list !== "shared") return refusals.invalid("`list` is own or shared.");
		const page = Math.max(1, Number(params.get("page")) || 1);
		const pageSize = Math.min(MAX_COLLECTIONS_PAGE_SIZE, Math.max(1, Number(params.get("pageSize")) || MAX_COLLECTIONS_PAGE_SIZE));
		const readerId = await readerFor(config, database, (await props.params).clerkUserId);
		if (!readerId) return { body: { rows: [], page: 1, pages: 1, total: 0 } };
		const read = list === "own"
			? await readProfileCollections(database, readerId, readerId, { page, pageSize })
			: await readSharedCollections(database, readerId, { page, pageSize });
		return {
			body: {
				rows: read.rows.map(({ members: _members, ...row }) => ({ ...row, owner: "owner" in row ? { name: row.owner.name, image: row.owner.image } : null })),
				page: read.page,
				pages: read.pages,
				total: read.total,
			},
		};
	});
}
