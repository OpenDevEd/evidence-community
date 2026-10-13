import { answerOpenScholar, readerFor, refusals } from "@/lib/openscholar/library-reads";
import { readCollectionFor } from "@/lib/readers/data";

/** One reader collection as `reader` may see it, with its owner and their access: refused when it is private to them. */
export async function GET(request: Request, props: { params: Promise<{ id: string }> }) {
	return answerOpenScholar(request, "collections", async ({ config, database }) => {
		if (!config.features.readerAccounts) return refusals.readerAccountsOff;
		const readerId = await readerFor(config, database, new URL(request.url).searchParams.get("reader"));
		const found = await readCollectionFor(database, (await props.params).id, readerId);
		if ("refused" in found) return found.refused === 403 ? refusals.private : refusals.notFound;
		const { ownerId: _ownerId, owner, ...collection } = found.collection;
		return { body: { ...collection, owner: owner ? { name: owner.name, image: owner.image } : null } };
	});
}
