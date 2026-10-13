import { z } from "zod";
import { fromError } from "zod-validation-error";

import { answerOpenScholar, publicKeys, readerFor, refusals } from "@/lib/openscholar/library-reads";
import { changeCollectionItems } from "@/lib/readers/data";

/** Most records one change takes. */
const KEYS_MAX = 500;
const bodySchema = z.object({ keys: z.array(z.string().regex(/^[A-Z0-9]{8}$/u)).min(1).max(KEYS_MAX) }).strict();

type Props = { params: Promise<{ clerkUserId: string; id: string }> };

/**
 * Puts records into a collection, or takes them out, as a person who owns or edits it here. Answers how many it holds
 * after, the keys that went in or came out, and the keys the library doesn't show, which are never added.
 */
function change(request: Request, props: Props, kind: "add" | "remove") {
	return answerOpenScholar(request, `readers/collections/records:${kind}`, async ({ config, database }) => {
		if (!config.features.readerAccounts) return refusals.readerAccountsOff;
		const body = bodySchema.safeParse(await request.json().catch(() => null));
		if (!body.success) return refusals.invalid(fromError(body.error).toString());
		const { clerkUserId, id } = await props.params;
		const readerId = await readerFor(config, database, clerkUserId);
		if (!readerId) return refusals.notReader;
		// Only records the library shows go in, read as the change is made; any may come out.
		const keys = [...new Set(body.data.keys)];
		const changed = await changeCollectionItems(database, readerId, id, keys, kind, (transaction, wanted) => publicKeys(config, transaction, wanted, { lock: true }));
		if ("refused" in changed) return changed.refused === 403 ? refusals.role : refusals.notFound;
		return { body: { count: changed.count, changed: changed.changed, missing: keys.filter((key) => !changed.taken.includes(key)) } };
	});
}

export const POST = (request: Request, props: Props) => change(request, props, "add");
export const DELETE = (request: Request, props: Props) => change(request, props, "remove");
