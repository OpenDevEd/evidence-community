import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/database-schema";
import { addedPaper, sourceConnection } from "@/db/schema/source";
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
		// `reader`: anyone signed in outside the team, who suggests papers like a Creator (#777).
		role: z.enum(["owner", "editor", "creator", "reader"]),
	})
	.strict();

/**
 * Takes a paper off the community's added papers. One waiting for review is withdrawn from the queue: a Creator
 * withdraws only their own. One on the community is unpublished, as the admin's Unpublish does, by an Editor or Owner.
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
	await unpublishNativeItemWithOutcome(db, itemKey);
	return "removed";
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
