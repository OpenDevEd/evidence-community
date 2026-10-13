import { z } from "zod";
import { fromError } from "zod-validation-error";

import { answerOpenScholar, readerFor, refusals } from "@/lib/openscholar/library-reads";
import { createReaderCollectionOnce, readCollectionFor, readerCollectionInputSchema, readProfileCollections, readSharedCollections } from "@/lib/readers/data";

/** Most collections one page holds: OpenScholar lists a person's collections here in one read. */
const PAGE_SIZE_MAX = 100;

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
		const pageSize = Math.min(PAGE_SIZE_MAX, Math.max(1, Number(params.get("pageSize")) || PAGE_SIZE_MAX));
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

const createSchema = readerCollectionInputSchema.extend({ requestId: z.string().trim().min(1).max(200) }).strict();

/**
 * Makes a collection for a person who signed in here, as their profile does. The same `requestId` again answers the
 * collection it made, so a retry never makes two.
 */
export async function POST(request: Request, props: { params: Promise<{ clerkUserId: string }> }) {
	return answerOpenScholar(request, "readers/collections:create", async ({ config, database }) => {
		if (!config.features.readerAccounts) return refusals.readerAccountsOff;
		const input = createSchema.safeParse(await request.json().catch(() => null));
		if (!input.success) return refusals.invalid(fromError(input.error).toString());
		const readerId = await readerFor(config, database, (await props.params).clerkUserId);
		if (!readerId) return refusals.notReader;
		const { requestId, ...collection } = input.data;
		const id = await createReaderCollectionOnce(database, readerId, collection, requestId);
		const read = await readCollectionFor(database, id, readerId);
		if (!("collection" in read) || !read.collection) return refusals.notFound;
		const { ownerId: _owner, owner, ...made } = read.collection;
		return { body: { collection: { ...made, owner: owner ? { name: owner.name, image: owner.image } : null } }, status: 201 };
	});
}
