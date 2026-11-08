import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "@/db/database-schema";
import { addedPaper, sourceConnection } from "@/db/schema/source";
import { addedPapersConfigSchema } from "@/lib/source-ingestion/openalex/schema";
import { requestSourceRun } from "@/lib/source-ingestion/run-requests";

import { latestReview } from "./added-papers-service";
import { ADDED_PAPERS_SOURCE_CONNECTION_KEY } from "./constants";
import { AdminValidationError } from "./errors";
import { ItemNotFoundError, unpublishNativeItemWithOutcome } from "./native-item-service";
import { resolveItemReview, type ReviewActor } from "./review-service";

/** The person acting, as OpenScholar names them, and the role it gives them in this community. */
export const actorSchema = z
	.object({
		clerkUserId: z.string().min(1).max(128),
		name: z.string().max(255).nullable(),
		role: z.enum(["owner", "editor", "creator"]),
	})
	.strict();

/**
 * Takes a paper off the community's added papers. One waiting for review is withdrawn from the queue: a Creator
 * withdraws only their own. One on the community is unpublished, as the admin's Unpublish does, by an Editor or Owner.
 */
export async function removeAddedPaper(db: Database, itemKey: string, actor: ReviewActor): Promise<"withdrawn" | "removed"> {
	const [row] = await db.select({ state: addedPaper.state }).from(addedPaper).where(eq(addedPaper.itemKey, itemKey));
	if (!row) throw new ItemNotFoundError(itemKey);
	if (row.state === "pending") {
		const review = await latestReview(db, itemKey);
		// Returned or withdrawn already: there's nothing left in the queue to take back.
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
	const current = await addedPapersSettings(db);
	const next = { ...current, ...change };
	await db
		.update(sourceConnection)
		.set({ status: next.enabled ? "active" : "paused", config: { downloadPdfs: next.downloadPdfs }, updatedAt: new Date() })
		.where(eq(sourceConnection.key, ADDED_PAPERS_SOURCE_CONNECTION_KEY));
	if (next.enabled && (!current.enabled || (next.downloadPdfs && !current.downloadPdfs))) await requestSourceRun(db, ADDED_PAPERS_SOURCE_CONNECTION_KEY);
	return next;
}
