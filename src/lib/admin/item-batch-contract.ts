import { isCanonicalRecordKey } from "@opendeved/evidence-library-core";
import { z } from "zod";

import type { AdminErrorCode, AdminFieldErrors } from "./errors";
import type { AdminSearchIndexReceipt } from "./search-index-contract";

export const ADMIN_ITEM_BATCH_SIZE = 50;

const canonicalKeySchema = z.string().refine(isCanonicalRecordKey, {
	message: "Choose an available record.",
});
const itemKeysSchema = z
	.array(canonicalKeySchema)
	.min(1, "Select at least one record.")
	.max(
		ADMIN_ITEM_BATCH_SIZE,
		`Select no more than ${ADMIN_ITEM_BATCH_SIZE} records at once.`,
	)
	.refine((keys) => new Set(keys).size === keys.length, {
		message: "Each selected record must be unique.",
	});

export const adminItemBatchRequestSchema = z.discriminatedUnion("action", [
	z.object({
		action: z.literal("assignCollection"),
		collectionKey: canonicalKeySchema,
		keys: itemKeysSchema,
	}),
	z.object({ action: z.literal("publish"), keys: itemKeysSchema }),
	z.object({ action: z.literal("remove"), keys: itemKeysSchema }),
]);

export type AdminItemBatchRequest = z.infer<typeof adminItemBatchRequestSchema>;

export type AdminItemBatchResult = {
	code?: AdminErrorCode;
	fields?: AdminFieldErrors;
	key: string;
	indexingReceipts: AdminSearchIndexReceipt[];
	message?: string;
	outcome: "changed" | "failed" | "skipped" | "unchanged";
	retryable?: boolean;
};

export type AdminItemBatchResponse = {
	results: AdminItemBatchResult[];
};
