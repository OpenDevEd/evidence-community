import { describe, expect, it } from "vitest";

import {
	adminSearchIndexShouldPollFast,
	deriveAdminSearchIndexView,
	mergeAdminSearchIndexReceipts,
	mergeAdminSearchIndexStatuses,
} from "@/components/admin/admin-search-index";
import { chunkValues } from "@/lib/chunk-values";
import type {
	AdminSearchIndexOverview,
	AdminSearchIndexReceipt,
	AdminSearchIndexReceiptStatus,
} from "@/lib/admin/search-index-contract";

const receipt: AdminSearchIndexReceipt = {
	entityKey: "TESTBOOK",
	entityType: "item",
	revision: 1,
};

function status(
	state: AdminSearchIndexReceiptStatus["state"],
	overrides: Partial<AdminSearchIndexReceiptStatus> = {},
): AdminSearchIndexReceiptStatus {
	return {
		...receipt,
		attempts: 0,
		createdAt: "2026-08-04T10:00:00.000Z",
		error: null,
		nextAttemptAt: "2026-08-04T10:00:00.000Z",
		processedAt:
			state === "indexed" ? "2026-08-04T10:00:01.000Z" : null,
		state,
		...overrides,
	};
}

function overview(
	overrides: Partial<AdminSearchIndexOverview["worker"] & object> = {},
	queue: Partial<AdminSearchIndexOverview["queue"]> = {},
): AdminSearchIndexOverview {
	return {
		queue: {
			hasFailed: false,
			hasPending: false,
			nextAttemptAt: null,
			...queue,
		},
		worker: {
			active: true,
			batchProgress: null,
			batchUid: null,
			currentEventCount: 0,
			heartbeatAt: "2026-08-04T10:00:00.000Z",
			lastCompletedAt: null,
			lastError: null,
			stage: "idle",
			startedAt: "2026-08-04T09:00:00.000Z",
			stoppedAt: null,
			taskUid: null,
			workerId: "search-indexer",
			...overrides,
		},
	};
}

function view(input: {
	completed?: boolean;
	error?: string | null;
	loading?: boolean;
	overview?: AdminSearchIndexOverview | null;
	receiptUnavailable?: boolean;
	receipts?: AdminSearchIndexReceiptStatus[];
	retrying?: boolean;
}) {
	return deriveAdminSearchIndexView({
		completed: input.completed ?? false,
		error: input.error ?? null,
		loading: input.loading ?? false,
		overview: input.overview ?? null,
		receiptUnavailable: input.receiptUnavailable ?? false,
		receipts: input.receipts ?? [],
		retrying: input.retrying ?? false,
	});
}

describe("admin search indexing UI state", () => {
	it("keeps only the latest receipt for an entity", () => {
		const initial = [status("failed")];
		const merged = mergeAdminSearchIndexReceipts(initial, [
			{ ...receipt, revision: 2 },
			{ ...receipt, revision: 1 },
		]);
		expect(merged).toEqual([
			expect.objectContaining({ revision: 2, state: "queued" }),
		]);
	});

	it("merges authoritative states without reordering tracked work", () => {
		const second = status("queued", {
			entityKey: "SECOND01",
			revision: 2,
		});
		expect(
			mergeAdminSearchIndexStatuses(
				[status("queued"), second],
				[status("indexed", { entityKey: "SECOND01", revision: 2 })],
			),
		).toEqual([
			status("queued"),
			status("indexed", { entityKey: "SECOND01", revision: 2 }),
		]);
	});

	it("chunks arbitrarily large receipt sets at the API limit", () => {
		const receipts = Array.from({ length: 201 }, (_, revision) => ({
			...receipt,
			revision: revision + 1,
		}));
		expect(
			chunkValues(receipts, 100).map(
				(chunk) => chunk.length,
			),
		).toEqual([100, 100, 1]);
		expect(() => chunkValues(receipts, 0)).toThrow(
			"must be a positive integer",
		);
	});

	it("shows checking, unavailable, ready, and offline states", () => {
		expect(view({ loading: true }).kind).toBe("checking");
		expect(view({ error: "offline" }).kind).toBe("unavailable");
		expect(view({ receiptUnavailable: true }).kind).toBe("unavailable");
		expect(
			view({ error: "offline", overview: overview() }).kind,
		).toBe("unavailable");
		expect(view({ overview: overview() }).kind).toBe("ready");
		expect(
			view({ overview: overview({ active: false, stage: "stopped" }) })
				.kind,
		).toBe("offline");
	});

	it("uses the real worker stage and percentage without inventing progress", () => {
		const projecting = view({
			overview: overview(
				{ currentEventCount: 2, stage: "projecting" },
				{ hasPending: true },
			),
		});
		expect(projecting).toMatchObject({
			kind: "indexing",
			label: "Preparing search",
			progress: null,
		});

		const waiting = view({
			overview: overview(
				{ currentEventCount: 2, stage: "waiting", taskUid: 4 },
				{ hasPending: true },
			),
		});
		expect(waiting).toMatchObject({
			kind: "queued",
			label: "Search queued",
			progress: null,
		});

		const indexing = view({
			overview: overview(
				{
					batchProgress: 47.6,
					batchUid: 3,
					currentEventCount: 2,
					stage: "indexing",
					taskUid: 4,
				},
				{ hasPending: true },
			),
		});
		expect(indexing).toMatchObject({
			label: "Indexing 48%",
			progress: 47.6,
		});
	});

	it("distinguishes queued, processing, and automatic retry states", () => {
		expect(
			view({ overview: overview(), receipts: [status("queued")] }),
		).toMatchObject({ kind: "queued", label: "Search queued" });
		expect(
			view({
				overview: overview({ stage: "projecting" }),
				receipts: [status("processing")],
			}),
		).toMatchObject({ kind: "indexing", label: "Preparing search" });
		expect(
			view({
				overview: overview({
					lastError: "temporary failure",
					stage: "retrying",
				}),
				receipts: [status("retrying")],
			}),
		).toMatchObject({
			canRetry: false,
			kind: "retrying",
			label: "Retry scheduled",
			progress: null,
		});
		expect(
			view({
				overview: overview({
					lastError: "temporary failure",
					stage: "retrying",
				}),
			}),
		).toMatchObject({
			canRetry: false,
			kind: "retrying",
			label: "Retry scheduled",
			progress: null,
		});
	});

	it("distinguishes saved work waiting for a worker from indexed work", () => {
		expect(
			view({
				overview: overview({ active: false, stage: "stopped" }),
				receipts: [status("queued")],
			}),
		).toMatchObject({ kind: "offline", label: "Search paused" });
		expect(
			view({ completed: true, overview: overview() }),
		).toMatchObject({ kind: "indexed", label: "Search updated" });
	});

	it("puts actionable failures and retry activity ahead of other states", () => {
		expect(
			view({ overview: overview(), receipts: [status("failed")] }),
		).toMatchObject({ canRetry: true, kind: "failed" });
		expect(
			view({
				overview: overview({}, { hasFailed: true, hasPending: true }),
			}),
		).toMatchObject({ canRetry: true, kind: "failed" });
		expect(
			view({
				overview: overview({}, { hasFailed: true }),
				retrying: true,
			}),
		).toMatchObject({ canRetry: false, kind: "retrying" });
	});

	it("polls quickly only while exact or global work remains", () => {
		expect(adminSearchIndexShouldPollFast(overview(), [])).toBe(false);
		expect(
			adminSearchIndexShouldPollFast(
				overview({}, { hasPending: true }),
				[],
			),
		).toBe(true);
		expect(
			adminSearchIndexShouldPollFast(
				overview({ lastError: "temporary failure", stage: "retrying" }),
				[],
			),
		).toBe(true);
		expect(
			adminSearchIndexShouldPollFast(overview(), [status("processing")]),
		).toBe(true);
		expect(
			adminSearchIndexShouldPollFast(overview(), [status("indexed")]),
		).toBe(false);
		expect(
			adminSearchIndexShouldPollFast(overview(), [status("unknown")]),
		).toBe(false);
	});
});
