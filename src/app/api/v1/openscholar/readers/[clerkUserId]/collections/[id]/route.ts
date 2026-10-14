import { z } from "zod";

import { answerOpenScholar, readerCollectionChange, refusals } from "@/lib/openscholar/library-reads";
import { cancelCollectionInvitations } from "@/lib/readers/collection-invitations";
import { deleteOwnedCollection } from "@/lib/readers/data";

const bodySchema = z.object({ expect: z.object({ name: z.string(), records: z.number().int().min(0) }).strict().optional() }).strict();

type Props = { params: Promise<{ clerkUserId: string; id: string }> };

/**
 * Deletes a collection a person owns here, as their profile does: its records stay in their bookmarks, and its waiting
 * invitations are cancelled. With `expect` ({ name, records }), only while the collection still has that name and holds
 * that many records; one changed since is refused (409 `changed`) and stays. OpenScholar's assistant undoes a
 * collection it made this way.
 */
export async function DELETE(request: Request, props: Props) {
	return answerOpenScholar(request, "readers/collections:delete", async ({ config, database }) => {
		const asked = await readerCollectionChange(request, props.params, config, database, bodySchema);
		if (asked.refused) return asked.refused;
		const { body, clerkUserId, id, readerId } = asked;
		const done = await deleteOwnedCollection(database, readerId, id, body.expect);
		if (done.refused) return done.refused === 403 ? refusals.owner : refusals.notFound;
		if (done.changed) {
			const { name, records } = done.changed;
			return refusals.changed(`The collection changed since: it is "${name}" now and holds ${records} ${records === 1 ? "record" : "records"}, so it stays.`);
		}
		await cancelCollectionInvitations(config.authentication.openScholar, clerkUserId, id).catch((error: unknown) =>
			console.error("Cancelling a deleted collection's invitations failed", { readerId, collectionId: id, error }),
		);
		return { body: { deleted: true } };
	});
}
