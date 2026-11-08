import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database, DatabaseTransaction } from "@/db/database-schema";
import { itemReview } from "@/db/schema/review";
import { addedPaper, submissionStatusDelivery } from "@/db/schema/source";
import { postOpenScholarAssociation, runAssociationDeliveryCycle } from "@/lib/publication/association-queue";

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
	const [paper] = await transaction.select({ addedBy: addedPaper.addedBy, state: addedPaper.state }).from(addedPaper).where(eq(addedPaper.itemKey, job.itemKey));
	const [review] = await transaction
		.select({ state: itemReview.state, note: itemReview.note, submittedBy: itemReview.submittedBy, submittedAt: itemReview.submittedAt, resolvedAt: itemReview.resolvedAt })
		.from(itemReview)
		.where(and(eq(itemReview.itemKey, job.itemKey), inArray(itemReview.state, Object.keys(STATUS_OF_REVIEW) as (keyof typeof STATUS_OF_REVIEW)[])))
		.orderBy(desc(itemReview.submittedAt))
		.limit(1);
	if (!paper || !review) return null;
	const libraryId = config.authentication.openScholar.libraryId;
	const accepted = paper.state === "accepted";
	return submissionStatusSchema.parse({
		contractVersion: 1,
		idempotencyKey: `${libraryId}:${job.itemKey}:${job.generation}`,
		libraryId,
		itemKey: job.itemKey,
		generation: Number(job.generation),
		clerkUserId: accepted ? paper.addedBy : review.submittedBy,
		status: accepted ? "published" : STATUS_OF_REVIEW[review.state as keyof typeof STATUS_OF_REVIEW],
		note: !accepted && review.state === "returned" ? review.note : null,
		at: (review.resolvedAt ?? review.submittedAt).toISOString(),
	});
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
