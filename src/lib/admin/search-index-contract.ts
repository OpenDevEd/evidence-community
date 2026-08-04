import {
	isCanonicalRecordKey,
	SEARCH_INDEX_WORKER_STAGES,
} from "@opendeved/evidence-library-core";
import { z } from "zod";

export const ADMIN_SEARCH_INDEX_RECEIPT_LIMIT = 100;

export const adminSearchIndexReceiptSchema = z
	.object({
		entityKey: z.string().refine(isCanonicalRecordKey, {
			message: "Choose an available record.",
		}),
		entityType: z.enum(["item", "collection"]),
		revision: z.number().int().positive().safe(),
	})
	.strict();

export const adminSearchIndexReceiptsSchema = z
	.object({
		receipts: z
			.array(adminSearchIndexReceiptSchema)
			.min(1, "Choose at least one indexing update.")
			.max(
				ADMIN_SEARCH_INDEX_RECEIPT_LIMIT,
				`Choose no more than ${ADMIN_SEARCH_INDEX_RECEIPT_LIMIT} indexing updates at once.`,
			)
			.refine(
				(receipts) =>
					new Set(receipts.map(adminSearchIndexReceiptIdentity)).size ===
					receipts.length,
				{ message: "Each indexing update must be unique." },
			),
	})
	.strict();

export const adminSearchIndexRetrySchema = z.discriminatedUnion("scope", [
	z.object({ scope: z.literal("allFailed") }).strict(),
	z
		.object({
			receipts: adminSearchIndexReceiptsSchema.shape.receipts,
			scope: z.literal("receipts"),
		})
		.strict(),
]);

export type AdminSearchIndexReceipt = z.infer<
	typeof adminSearchIndexReceiptSchema
>;

export function adminSearchIndexReceiptIdentity(
	receipt: AdminSearchIndexReceipt,
) {
	return `${receipt.entityType}:${receipt.entityKey}:${receipt.revision}`;
}

export type AdminSearchIndexReceiptsRequest = z.infer<
	typeof adminSearchIndexReceiptsSchema
>;
export type AdminSearchIndexRetryRequest = z.infer<
	typeof adminSearchIndexRetrySchema
>;

export const adminSearchIndexReceiptStateSchema = z.enum([
	"failed",
	"indexed",
	"processing",
	"queued",
	"retrying",
	"unknown",
]);

export type AdminSearchIndexReceiptState = z.infer<
	typeof adminSearchIndexReceiptStateSchema
>;

export const adminSearchIndexReceiptStatusSchema =
	adminSearchIndexReceiptSchema.extend({
		attempts: z.number().int().nonnegative().nullable(),
		createdAt: z.string().nullable(),
		error: z.string().nullable(),
		nextAttemptAt: z.string().nullable(),
		processedAt: z.string().nullable(),
		state: adminSearchIndexReceiptStateSchema,
	});

export type AdminSearchIndexReceiptStatus = z.infer<
	typeof adminSearchIndexReceiptStatusSchema
>;

export const adminSearchIndexOverviewSchema = z
	.object({
		queue: z
			.object({
				hasFailed: z.boolean(),
				hasPending: z.boolean(),
				nextAttemptAt: z.string().nullable(),
			})
			.strict(),
		worker: z
			.object({
				active: z.boolean(),
				batchProgress: z.number().min(0).max(100).nullable(),
				batchUid: z.number().int().nonnegative().nullable(),
				currentEventCount: z.number().int().nonnegative(),
				heartbeatAt: z.string(),
				lastCompletedAt: z.string().nullable(),
				lastError: z.string().nullable(),
				stage: z.enum(SEARCH_INDEX_WORKER_STAGES),
				startedAt: z.string(),
				stoppedAt: z.string().nullable(),
				taskUid: z.number().int().nonnegative().nullable(),
				workerId: z.string().min(1),
			})
			.strict()
			.nullable(),
	})
	.strict();

export type AdminSearchIndexOverview = z.infer<
	typeof adminSearchIndexOverviewSchema
>;

export const adminSearchIndexMutationResultSchema = z
	.object({
		indexingReceipts: z.array(adminSearchIndexReceiptSchema),
	})
	.passthrough();

export type AdminSearchIndexMutationResult = z.infer<
	typeof adminSearchIndexMutationResultSchema
>;

export function adminSearchIndexReceipt(
	entityType: AdminSearchIndexReceipt["entityType"],
	record: { key: string; revision: number },
): AdminSearchIndexReceipt {
	return adminSearchIndexReceiptSchema.parse({
		entityKey: record.key,
		entityType,
		revision: record.revision,
	});
}
