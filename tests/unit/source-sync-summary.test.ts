import { describe, expect, it } from "vitest";

import { sourceSyncSummary } from "@/lib/admin/source-sync-summary";

const now = new Date("2026-09-04T12:00:00Z");
const base = {
	activeRunStartedAt: null,
	issueCount: 0,
	lastError: null,
	lastFailureAt: null,
	lastResult: null,
	lastSuccessAt: null,
	leaseExpiresAt: null,
	now,
	syncCursor: null,
};

describe("source sync summary", () => {
	it("reports a live run with the records processed so far", () => {
		expect(
			sourceSyncSummary({
				...base,
				activeRunStartedAt: new Date("2026-09-04T11:55:00Z"),
				leaseExpiresAt: new Date("2026-09-04T12:05:00Z"),
				syncCursor: { libraryVersion: 3, pending: { offset: 1_500 } },
			}),
		).toMatchObject({
			processed: 1_500,
			runningSince: "2026-09-04T11:55:00.000Z",
			status: "running",
		});
	});

	it("reports a run whose worker lease expired as failed, not as imported", () => {
		expect(
			sourceSyncSummary({
				...base,
				activeRunStartedAt: new Date("2026-09-04T09:00:00Z"),
				lastSuccessAt: new Date("2026-09-03T09:00:00Z"),
				leaseExpiresAt: new Date("2026-09-04T09:10:00Z"),
				syncCursor: { pending: { offset: 10 } },
			}),
		).toMatchObject({
			lastError: expect.stringContaining("stopped without finishing"),
			lastFailureAt: "2026-09-04T09:10:00.000Z",
			processed: null,
			runningSince: null,
			status: "failed",
		});
	});

	it("shows the last failure and its error", () => {
		expect(
			sourceSyncSummary({
				...base,
				issueCount: 2,
				lastError: "Check date and try again.",
				lastFailureAt: new Date("2026-09-04T11:00:00Z"),
				lastSuccessAt: new Date("2026-09-01T11:00:00Z"),
				lastResult: { records: 40 },
			}),
		).toEqual({
			issueCount: 2,
			lastError: "Check date and try again.",
			lastFailureAt: "2026-09-04T11:00:00.000Z",
			lastRecords: 40,
			lastSuccessAt: "2026-09-01T11:00:00.000Z",
			processed: null,
			runningSince: null,
			status: "failed",
		});
	});

	it("is idle before the first import", () => {
		expect(sourceSyncSummary(base)).toMatchObject({ status: "idle" });
	});
});
