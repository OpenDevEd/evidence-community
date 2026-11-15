import { itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { enqueueItemSearchReprojections } from "@/lib/publication/queue";
import { addedPaper, sourceConnection } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { itemFieldOverride } from "@/db/schema/topics";
import { addedPapersConfigSchema } from "@/lib/source-ingestion/openalex/schema";
import { requestSourceRun } from "@/lib/source-ingestion/run-requests";

import { ADD_PAPERS_MAX, latestReview, reviewerOf } from "./added-papers-service";
import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "./constants";
import { AdminValidationError } from "./errors";
import { ItemNotFoundError, unpublishNativeItemWithOutcome } from "./native-item-service";
import { resolveItemReview, type ReviewActor } from "./review-service";

/** The person acting, as OpenScholar names them, and the role it gives them in this community. */
/** Papers a request names, by OpenAlex ID or DOI. */
export const papersSchema = z
	.array(z.object({ openalexId: z.string().max(128).nullish(), doi: z.string().max(512).nullish(), link: z.string().max(2048).nullish() }).strict())
	.min(1)
	.max(ADD_PAPERS_MAX);

export const actorSchema = z
	.object({
		clerkUserId: z.string().min(1).max(128),
		name: z.string().max(255).nullable(),
		// Their address, which the review shows the Editors and Owners deciding it. Optional, as older Openscholar sends none.
		email: z.string().email().max(320).nullable().optional(),
		// `reader`: anyone signed in outside the team, who suggests papers like a Creator (#777).
		role: z.enum(["owner", "editor", "creator", "reader"]),
	})
	.strict();

/**
 * Takes a paper off the community's added papers. One waiting for review is withdrawn from the queue: a Creator
 * withdraws only their own. One on the community is unpublished, as the admin's Unpublish does, by an Editor or Owner,
 * unless another source still brings it, such as a connected collection: then it stays, as theirs.
 */
export async function removeAddedPaper(db: Database, itemKey: string, sender: { userId: string; role: ReviewActor["role"] | "reader" }): Promise<"withdrawn" | "removed"> {
	const actor = reviewerOf(sender);
	const [row] = await db.select({ state: addedPaper.state }).from(addedPaper).where(eq(addedPaper.itemKey, itemKey));
	if (!row) throw new ItemNotFoundError(itemKey);
	const review = row.state === "pending" ? await latestReview(db, itemKey) : undefined;
	// Approved since its row was read, it's live: removed below like any other. A review approved meanwhile fails the
	// withdrawal on its revision. Withdrawn already, it's gone; returned, it's the reviewer's answer to keep.
	if (row.state === "pending" && review?.state !== "published") {
		if (review?.state === "returned") throw new AdminValidationError("This paper was returned by a reviewer, so it isn't in the review queue to withdraw.");
		// Its request stopped before it reached the queue: sending it again finishes that, and there's nothing to take back yet.
		if (!review) throw new AdminValidationError("This paper isn't in the review queue yet. Send it again to finish sending it.");
		if (review?.state === "pending") await resolveItemReview(db, { reviewId: review.id, expectedRevision: review.revision, action: "withdrawn" }, actor);
		return "withdrawn";
	}
	if (actor.role === "creator") throw new AdminValidationError("Only an Editor or Owner can remove a paper from the community.");
	await removePublishedPaper(db, itemKey);
	return "removed";
}

/**
 * Takes a published paper off Added papers: unpublished unless another source still brings it, and the source lets go
 * of it and of what it brought with it.
 */
async function removePublishedPaper(db: Database, itemKey: string) {
	// Children still public now: only their deleted marks can come from this removal. One the team had unpublished
	// itself keeps its mark.
	const liveChildren = (await db.select({ key: item.key }).from(item).where(and(eq(item.parentItem, itemKey), eq(item.deleted, 0)))).map((child) => child.key);
	const keptBefore = await keptElsewhere(db, itemKey);
	if (!keptBefore) await unpublishNativeItemWithOutcome(db, itemKey);
	// Taken off, it's no longer one of the added papers: the source lets go of its work and of what it brought with it,
	// such as a report's PDF, so the paper can be added again as a new record with its own, and its sync doesn't bring
	// it back. Under the source writers' lock, so a collection letting go of the same record meanwhile is counted here,
	// and counts this removal in turn.
	const keptAfter = await db.transaction(async (transaction) => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`);
		const kept = await keptElsewhere(transaction, itemKey);
		await transaction
			.delete(itemSourceLink)
			.where(and(eq(itemSourceLink.sourceConnectionKey, ADDED_PAPERS_SOURCE_CONNECTION_KEY), or(eq(itemSourceLink.itemKey, itemKey), inArray(itemSourceLink.itemKey, childrenOf(transaction, itemKey)))));
		await transaction.delete(addedPaper).where(eq(addedPaper.itemKey, itemKey));
		// Kept as another source's, it is searched again: Added papers no longer counts among its sources.
		const [record] = kept ? await transaction.select({ itemKey: item.key, revision: item.revision }).from(item).where(and(eq(item.key, itemKey), eq(item.deleted, 0))) : [];
		if (record) await enqueueItemSearchReprojections(transaction, [record], new Date(), null);
		return kept;
	});
	// The other source let it go meanwhile: nothing brings it now.
	if (keptBefore && !keptAfter) await unpublishNativeItemWithOutcome(db, itemKey);
	// A child keeps its source record key, such as a report PDF's `doi:pdf:<doi>`, so the paper added again brings the
	// same child back. The unpublish marked it deleted as the team's own choice, which no source undoes: that mark goes
	// with the paper, or the child would stay deleted under the new record.
	if (!keptAfter && liveChildren.length) await db.delete(itemFieldOverride).where(and(inArray(itemFieldOverride.itemKey, liveChildren), eq(itemFieldOverride.field, "deleted")));
}

const childrenOf = (db: Database | DatabaseTransaction, itemKey: string) => db.select({ key: item.key }).from(item).where(eq(item.parentItem, itemKey));

/** Whether a source other than Added papers still brings this record, as a withdrawal counts one. */
async function keptElsewhere(db: Database | DatabaseTransaction, itemKey: string) {
	const [other] = await db
		.select({ key: itemSourceLink.sourceConnectionKey })
		.from(itemSourceLink)
		.innerJoin(sourceConnection, eq(sourceConnection.key, itemSourceLink.sourceConnectionKey))
		.where(and(eq(itemSourceLink.itemKey, itemKey), ne(itemSourceLink.sourceConnectionKey, ADDED_PAPERS_SOURCE_CONNECTION_KEY), eq(itemSourceLink.remoteDeleted, false), ne(sourceConnection.status, "removed")))
		.limit(1);
	return Boolean(other);
}

/** Whether the Added papers source syncs, and whether it fetches its papers' PDFs. */
export type AddedPapersSettings = { enabled: boolean; downloadPdfs: boolean };

export async function addedPapersSettings(db: Database): Promise<AddedPapersSettings> {
	const [row] = await db.select({ status: sourceConnection.status, config: sourceConnection.config }).from(sourceConnection).where(eq(sourceConnection.key, ADDED_PAPERS_SOURCE_CONNECTION_KEY));
	return { enabled: row?.status === "active", downloadPdfs: addedPapersConfigSchema.parse(row?.config ?? {}).downloadPdfs };
}

/** Pauses or resumes the Added papers source, or turns its PDFs on or off. Resumed, it syncs at once. */
export async function setAddedPapersSettings(db: Database, change: Partial<AddedPapersSettings>): Promise<AddedPapersSettings> {
	// Only what changed is written, so two changes sent together both hold.
	await db
		.update(sourceConnection)
		.set({
			...(change.enabled === undefined ? {} : { status: change.enabled ? "active" : "paused" }),
			...(change.downloadPdfs === undefined ? {} : { config: sql`jsonb_set(coalesce(${sourceConnection.config}, '{}'::jsonb), '{downloadPdfs}', to_jsonb(${change.downloadPdfs}::boolean))` }),
			updatedAt: new Date(),
		})
		.where(eq(sourceConnection.key, ADDED_PAPERS_SOURCE_CONNECTION_KEY));
	const settings = await addedPapersSettings(db);
	if (settings.enabled && (change.enabled || change.downloadPdfs)) await requestSourceRun(db, ADDED_PAPERS_SOURCE_CONNECTION_KEY);
	return settings;
}
