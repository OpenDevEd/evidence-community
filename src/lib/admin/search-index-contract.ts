import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { z } from "zod";

export const ADMIN_SEARCH_INDEX_RECEIPT_LIMIT = 100;

const receiptSchema = z
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
			.array(receiptSchema)
			.min(1, "Choose at least one indexing update.")
			.max(
				ADMIN_SEARCH_INDEX_RECEIPT_LIMIT,
				`Choose no more than ${ADMIN_SEARCH_INDEX_RECEIPT_LIMIT} indexing updates at once.`,
			)
			.refine(
				(receipts) =>
					new Set(
						receipts.map(
							(receipt) =>
								`${receipt.entityType}:${receipt.entityKey}:${receipt.revision}`,
						),
					).size === receipts.length,
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

export type AdminSearchIndexReceipt = z.infer<typeof receiptSchema>;
export type AdminSearchIndexReceiptsRequest = z.infer<
	typeof adminSearchIndexReceiptsSchema
>;
export type AdminSearchIndexRetryRequest = z.infer<
	typeof adminSearchIndexRetrySchema
>;

export type AdminSearchIndexReceiptState =
	| "failed"
	| "indexed"
	| "processing"
	| "queued"
	| "retrying"
	| "unknown";

export type AdminSearchIndexReceiptStatus = AdminSearchIndexReceipt & {
	attempts: number | null;
	createdAt: string | null;
	error: string | null;
	nextAttemptAt: string | null;
	processedAt: string | null;
	state: AdminSearchIndexReceiptState;
};

export function adminSearchIndexReceipt(
	entityType: AdminSearchIndexReceipt["entityType"],
	record: { key: string; revision: number },
): AdminSearchIndexReceipt {
	return receiptSchema.parse({
		entityKey: record.key,
		entityType,
		revision: record.revision,
	});
}
