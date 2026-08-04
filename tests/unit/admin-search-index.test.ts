import { describe, expect, it } from "vitest";

import {
	adminSearchIndexReceiptsSchema,
	adminSearchIndexRetrySchema,
} from "@/lib/admin/search-index-contract";
import { resolveAdminSearchIndexReceiptState } from "@/lib/admin/search-index-service";

const now = new Date("2026-08-04T12:00:00.000Z");
const baseRow = {
	attempts: 0,
	createdAt: new Date("2026-08-04T11:00:00.000Z"),
	deadLetteredAt: null,
	entityKey: "ABCD2345",
	entityType: "item" as const,
	lastError: null,
	leaseExpiresAt: null,
	leaseOwner: null,
	nextAttemptAt: new Date("2026-08-04T11:00:00.000Z"),
	processedAt: null,
	revision: 1,
};

describe("admin search indexing contract", () => {
	it("accepts bounded unique canonical receipts", () => {
		expect(
			adminSearchIndexReceiptsSchema.parse({
				receipts: [
					{
						entityKey: "ABCD2345",
						entityType: "item",
						revision: 2,
					},
				],
			}),
		).toEqual({
			receipts: [
				{
					entityKey: "ABCD2345",
					entityType: "item",
					revision: 2,
				},
			],
		});
	});

	it("rejects duplicate, malformed, and ambiguous retry requests", () => {
		const receipt = {
			entityKey: "ABCD2345",
			entityType: "item",
			revision: 2,
		};
		expect(
			adminSearchIndexReceiptsSchema.safeParse({
				receipts: [receipt, receipt],
			}).success,
		).toBe(false);
		expect(
			adminSearchIndexReceiptsSchema.safeParse({
				receipts: [{ ...receipt, entityKey: "not-a-key" }],
			}).success,
		).toBe(false);
		expect(
			adminSearchIndexRetrySchema.safeParse({ scope: "all" }).success,
		).toBe(false);
	});

	it("distinguishes indexed, failed, active, expired, and retrying receipts", () => {
		expect(
			resolveAdminSearchIndexReceiptState(
				{ ...baseRow, processedAt: now },
				now,
			),
		).toBe("indexed");
		expect(
			resolveAdminSearchIndexReceiptState(
				{ ...baseRow, deadLetteredAt: now },
				now,
			),
		).toBe("failed");
		expect(
			resolveAdminSearchIndexReceiptState(
				{
					...baseRow,
					leaseExpiresAt: new Date(now.getTime() + 1_000),
					leaseOwner: "worker",
				},
				now,
			),
		).toBe("processing");
		expect(
			resolveAdminSearchIndexReceiptState(
				{
					...baseRow,
					leaseExpiresAt: new Date(now.getTime() - 1),
					leaseOwner: "worker",
				},
				now,
			),
		).toBe("queued");
		expect(
			resolveAdminSearchIndexReceiptState(
				{ ...baseRow, attempts: 2 },
				now,
			),
		).toBe("retrying");
	});
});
