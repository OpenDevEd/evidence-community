import { itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, inArray, sql } from "drizzle-orm";

import type { DatabaseTransaction } from "@/db/database-schema";
import { addedPaper } from "@/db/schema/source";

import { openAlexItemKeys } from "@/lib/source-ingestion/openalex/references";

import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "./constants";
import { AdminValidationError } from "./errors";

type Writer = Pick<DatabaseTransaction, "insert" | "update" | "select" | "execute">;

/** Ties a record to its OpenAlex work, so the Added papers source's next sync keeps it up to date from OpenAlex. */
export async function linkAddedPaper(transaction: Writer, itemKey: string, openalexId: string) {
	await transaction.update(addedPaper).set({ openalexId }).where(eq(addedPaper.itemKey, itemKey));
	// The link is what the source's sync, and any other OpenAlex source, finds the record by. A paper first found by
	// its DOI keeps the key it was reserved under: its published row holds that key.
	// A paper first found by its DOI was linked under its own key; the link now names its work.
	await transaction
		.insert(itemSourceLink)
		.values({ itemKey, sourceConnectionKey: ADDED_PAPERS_SOURCE_CONNECTION_KEY, sourceRecordKey: openalexId })
		.onConflictDoUpdate({ target: [itemSourceLink.itemKey, itemSourceLink.sourceConnectionKey], set: { sourceRecordKey: openalexId } });
}

/**
 * Accepts the added papers among records a review publishes. A paper OpenAlex has is linked to its work now; the
 * source's next sync looks for one known only by its DOI.
 */
export async function acceptAddedPapers(transaction: Writer, itemKeys: readonly string[]) {
	if (!itemKeys.length) return;
	const waiting = await transaction
		.select({ itemKey: addedPaper.itemKey, openalexId: addedPaper.openalexId })
		.from(addedPaper)
		.where(and(inArray(addedPaper.itemKey, [...itemKeys]), eq(addedPaper.state, "pending")));
	if (!waiting.length) return;
	// Another source may have brought the same work in while it waited. The OpenAlex writer's lock holds imports back
	// while that is checked, and approving would make it the work's second record.
	await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`);
	const works = waiting.flatMap((paper) => paper.openalexId ?? []);
	const elsewhere = [...(await openAlexItemKeys(transaction, works)).values()].find((itemKey) => !itemKeys.includes(itemKey));
	if (elsewhere) {
		throw new AdminValidationError(`This paper is already in the community as record ${elsewhere}, which another source brought in. Return this submission instead.`);
	}
	const accepted = await transaction
		.update(addedPaper)
		.set({ state: "accepted", acceptedAt: new Date() })
		.where(and(inArray(addedPaper.itemKey, [...itemKeys]), eq(addedPaper.state, "pending")))
		.returning({ itemKey: addedPaper.itemKey, openalexId: addedPaper.openalexId });
	for (const paper of accepted) {
		if (paper.openalexId) await linkAddedPaper(transaction, paper.itemKey, paper.openalexId);
		// One found only by its DOI still belongs to the source, under its own key until OpenAlex has it. With no
		// snapshot from OpenAlex, a scan never withdraws it.
		else await transaction.insert(itemSourceLink).values({ itemKey: paper.itemKey, sourceConnectionKey: ADDED_PAPERS_SOURCE_CONNECTION_KEY, sourceRecordKey: paper.itemKey }).onConflictDoNothing();
	}
}
