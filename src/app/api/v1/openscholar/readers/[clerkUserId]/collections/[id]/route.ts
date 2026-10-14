import { z } from "zod";

import { answerOpenScholar, readerCollectionChange, refusals } from "@/lib/openscholar/library-reads";
import { cancelCollectionInvitations } from "@/lib/readers/collection-invitations";
import { deleteOwnedCollection } from "@/lib/readers/data";

const asMadeSchema = z.object({ name: z.string(), description: z.string().nullable(), private: z.boolean(), records: z.number().int().min(0), members: z.number().int().min(0) }).strict();
const bodySchema = z.object({ expect: asMadeSchema.optional() }).strict();

type Props = { params: Promise<{ clerkUserId: string; id: string }> };

/**
 * Deletes a collection a person owns here, as their profile does: its records stay in their bookmarks, and its waiting
 * invitations are cancelled. With `expect` ({ name, description, private, records, members }), only while the collection
 * is still as made; one changed since is refused (409 `changed`) and stays. OpenScholar's assistant undoes a collection
 * it made this way.
 */
export async function DELETE(request: Request, props: Props) {
	return answerOpenScholar(request, "readers/collections:delete", async ({ config, database }) => {
		const asked = await readerCollectionChange(request, props.params, config, database, bodySchema);
		if (asked.refused) return asked.refused;
		const { body, clerkUserId, id, readerId } = asked;
		const done = await deleteOwnedCollection(database, readerId, id, body.expect);
		if (done.refused) return done.refused === 403 ? refusals.owner : refusals.notFound;
		if (done.changed) return refusals.changed(`The collection changed since it was made (its ${done.changed.join(", ")}), so it stays.`);
		await cancelCollectionInvitations(config.authentication.openScholar, clerkUserId, id).catch((error: unknown) =>
			console.error("Cancelling a deleted collection's invitations failed", { readerId, collectionId: id, error }),
		);
		return { body: { deleted: true } };
	});
}
