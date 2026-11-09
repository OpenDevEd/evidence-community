import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemReview } from "@/db/schema/review";
import { addedPaper, submissionStatusDelivery } from "@/db/schema/source";
import { postOpenScholarAssociation, runAssociationDeliveryCycle } from "@/lib/publication/association-queue";
import { summaryOf } from "./paper-summary";

/** Where a submitted paper stands, as Openscholar keeps it (OpenDevEd/new-el#778). */
const STATUS_OF_REVIEW = { pending: "queued", published: "published", returned: "returned", withdrawn: "withdrawn" } as const;

const submissionStatusSchema = z
	.object({
		contractVersion: z.literal(1),
		idempotencyKey: z.string().min(1).max(256),
		libraryId: z.string().min(1).max(128),
		itemKey: z.string().min(1).max(64),
		generation: z.number().int().positive(),
		/** The person who sent it, by their Openscholar (Clerk) user. */
		clerkUserId: z.string().min(1).max(128),
		status: z.enum(["queued", "published", "returned", "withdrawn"]),
		/** Why a reviewer returned it, when they said. */
		note: z.string().max(4000).nullable(),
		at: z.string(),
		/** What the paper is, so one sent from this site becomes the person's submission on Openscholar too. */
		paper: z
			.object({ title: z.string().min(1).max(1000), authors: z.string().max(2000), year: z.number().int().nullable(), openalexId: z.string().max(64).nullable(), doi: z.string().max(512).nullable(), requestId: z.string().min(1).max(128) })
			.strict()
			.optional(),
	})
	.strict();
const receiptSchema = z.object({ idempotencyKey: z.string(), generation: z.number() });

/**
 * Sends Openscholar where these records stand now, when they're added papers: submitted, approved, returned or
 * withdrawn. Runs in
 * the change's own transaction, so a change that's saved is always sent; a later one takes the row over.
 */
export async function queueSubmissionStatus(transaction: DatabaseTransaction, itemKeys: readonly string[]) {
	if (!itemKeys.length) return;
	await transaction.execute(sql`INSERT INTO "submissionStatusDelivery" ("itemKey", "revision")
		SELECT "itemKey", 0 FROM "addedPaper" WHERE "itemKey" IN (${sql.join(itemKeys.map((key) => sql`${key}`), sql`, `)})
		ON CONFLICT ("itemKey") DO UPDATE SET "generation" = "submissionStatusDelivery"."generation" + 1, "payload" = NULL,
			"attempts" = 0, "nextAttemptAt" = now(), "leaseToken" = NULL, "leaseExpiresAt" = NULL, "lastError" = NULL`);
}

/**
 * The change to send for one paper. Accepted, it stays published whatever later edits to it do. Until then it stands
 * where its latest review does, and is sent as the person who submitted that review.
 */
async function payloadOf(transaction: DatabaseTransaction, config: LibraryServerConfig, job: { itemKey: string; generation: number }) {
	const [paper] = await transaction.select({ state: addedPaper.state, openalexId: addedPaper.openalexId, doi: addedPaper.doi, requestId: addedPaper.requestId, resendRequestIds: addedPaper.resendRequestIds }).from(addedPaper).where(eq(addedPaper.itemKey, job.itemKey));
	if (!paper) return null;
	const accepted = paper.state === "accepted";
	// Accepted, it's the version that was: sent by whoever sent that one, whatever later edits do.
	const review = await reviewOf(transaction, job.itemKey, accepted);
	if (!review) return null;
	const libraryId = config.authentication.openScholar.libraryId;
	return submissionStatusSchema.parse({
		contractVersion: 1,
		idempotencyKey: `${libraryId}:${job.itemKey}:${job.generation}`,
		libraryId,
		itemKey: job.itemKey,
		generation: Number(job.generation),
		clerkUserId: review.submittedBy,
		status: accepted ? "published" : STATUS_OF_REVIEW[review.state as keyof typeof STATUS_OF_REVIEW],
		note: !accepted && review.state === "returned" ? review.note : null,
		at: (review.resolvedAt ?? review.submittedAt).toISOString(),
		paper: summaryForOpenScholar(review.snapshot, job.itemKey, paper),
	});
}

/** The paper's review to tell of: the one that accepted it, or else its latest. */
async function reviewOf(transaction: DatabaseTransaction, itemKey: string, accepted: boolean) {
	const [review] = await transaction
		.select({ state: itemReview.state, note: itemReview.note, submittedBy: itemReview.submittedBy, submittedAt: itemReview.submittedAt, resolvedAt: itemReview.resolvedAt, snapshot: itemReview.snapshot })
		.from(itemReview)
		.where(and(eq(itemReview.itemKey, itemKey), accepted ? eq(itemReview.state, "published") : inArray(itemReview.state, Object.keys(STATUS_OF_REVIEW) as (keyof typeof STATUS_OF_REVIEW)[])))
		.orderBy(accepted ? asc(itemReview.submittedAt) : desc(itemReview.submittedAt))
		.limit(1);
	return review;
}

/**
 * The paper as its review shows it, within what Openscholar keeps of a title and its authors, with the request that
 * sent it: Openscholar's own send of it, still finishing, then leaves this word as it is.
 */
function summaryForOpenScholar(snapshot: unknown, itemKey: string, paper: { openalexId: string | null; doi: string | null; requestId: string; resendRequestIds: string[] }) {
	const record = (snapshot as { records?: { itemKey: string; payload: Record<string, unknown> }[] } | null)?.records?.find((entry) => entry.itemKey === itemKey);
	const { title, authors, year } = summaryOf(record?.payload ?? {});
	return { title: title.slice(0, 1000), authors: authors.slice(0, 2000), year, openalexId: paper.openalexId, doi: paper.doi, requestId: paper.resendRequestIds.at(-1) ?? paper.requestId };
}

/** Sends waiting changes of submitted papers to Openscholar for up to five seconds; true when it sent any. */
export async function runSubmissionStatusCycle(database: Database, config: LibraryServerConfig, signal?: AbortSignal, request: typeof fetch = fetch) {
	const deadline = Date.now() + 5_000;
	let processed = false;
	while (Date.now() < deadline && !signal?.aborted) {
		const claimed = await runAssociationDeliveryCycle(database, "submissionStatusDelivery", async (job, leaseToken) => {
			const payload = await database.transaction(async (transaction) => {
				const [current] = await transaction
					.select()
					.from(submissionStatusDelivery)
					.where(and(eq(submissionStatusDelivery.itemKey, job.itemKey), eq(submissionStatusDelivery.leaseToken, leaseToken)))
					.for("update")
					.limit(1);
				if (!current) return null;
				if (current.payload) return submissionStatusSchema.parse(current.payload);
				const made = await payloadOf(transaction, config, job);
				if (made) await transaction.update(submissionStatusDelivery).set({ payload: made }).where(eq(submissionStatusDelivery.itemKey, job.itemKey));
				return made;
			});
			if (!payload) return;
			const response = await postOpenScholarAssociation(config, "/api/v1/evidence-libraries/paper-submissions", "submission status", payload, signal, request);
			const receipt = receiptSchema.parse(await response.json());
			if (receipt.idempotencyKey !== payload.idempotencyKey || receipt.generation !== payload.generation) throw new Error("Submission status receipt did not match the delivery");
		});
		if (!claimed) break;
		processed = true;
	}
	return processed;
}
