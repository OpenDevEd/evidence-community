import { itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import type { DatabaseTransaction } from "@/db/database-schema";
import { addedPaper } from "@/db/schema/source";

import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "./constants";

type Writer = Pick<DatabaseTransaction, "insert" | "update">;

/** Ties a record to its OpenAlex work, so the Added papers source's next sync keeps it up to date from OpenAlex. */
export async function linkAddedPaper(transaction: Writer, itemKey: string, openalexId: string) {
	await transaction.update(addedPaper).set({ openalexId }).where(eq(addedPaper.itemKey, itemKey));
	// The link is what the source's sync finds the record by. A paper first found by its DOI keeps the key it was
	// reserved under: its published row holds that key. ponytail: another OpenAlex source importing the same work later
	// would not join it, since joins match reserved keys; record the work on the identity if that ever happens.
	await transaction
		.insert(itemSourceLink)
		.values({ itemKey, sourceConnectionKey: ADDED_PAPERS_SOURCE_CONNECTION_KEY, sourceRecordKey: openalexId })
		.onConflictDoNothing();
}

/**
 * Accepts the added papers among records a review publishes. A paper OpenAlex has is linked to its work now; the
 * source's next sync looks for one known only by its DOI.
 */
export async function acceptAddedPapers(transaction: Writer, itemKeys: readonly string[]) {
	if (!itemKeys.length) return;
	const accepted = await transaction
		.update(addedPaper)
		.set({ state: "accepted", acceptedAt: new Date() })
		.where(and(inArray(addedPaper.itemKey, [...itemKeys]), eq(addedPaper.state, "pending")))
		.returning({ itemKey: addedPaper.itemKey, openalexId: addedPaper.openalexId });
	for (const paper of accepted) if (paper.openalexId) await linkAddedPaper(transaction, paper.itemKey, paper.openalexId);
}
