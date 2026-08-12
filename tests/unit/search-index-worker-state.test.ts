import { describe, expect, it } from "vitest";

import {
	createSearchIndexWorkerStateReporter,
	searchIndexWorkerIsActive,
	searchIndexWorkerIsReady,
	type SearchIndexWorkerSnapshot,
} from "@/lib/search-index/worker-state";

const snapshot: SearchIndexWorkerSnapshot = {
	currentBatchProgress: null,
	currentBatchUid: null,
	currentEventCount: 0,
	currentTaskUid: null,
	heartbeatAt: new Date("2026-08-04T12:00:00.000Z"),
	instanceId: "instance-test",
	lastCompletedAt: null,
	lastError: null,
	stage: "idle",
	startedAt: new Date("2026-08-04T11:00:00.000Z"),
	stoppedAt: null,
	workerId: "search-indexer:test",
};

describe("search index worker state", () => {
	it("reports only a fresh, non-stopped heartbeat as active", () => {
		const now = new Date("2026-08-04T12:00:10.000Z");

		expect(searchIndexWorkerIsActive(snapshot, now, 15_000)).toBe(true);
		expect(
			searchIndexWorkerIsActive(
				{
					...snapshot,
					heartbeatAt: new Date("2026-08-04T11:59:44.999Z"),
				},
				now,
				15_000,
			),
		).toBe(false);
		expect(
			searchIndexWorkerIsActive(
				{
					...snapshot,
					stoppedAt: new Date("2026-08-04T12:00:05.000Z"),
				},
				now,
				15_000,
			),
		).toBe(false);
	});

	it("reports a worker as ready only after startup finishes", () => {
		const now = new Date("2026-08-04T12:00:10.000Z");

		expect(searchIndexWorkerIsReady(snapshot, now, 15_000)).toBe(true);
		expect(
			searchIndexWorkerIsReady(
				{
					...snapshot,
					stage: "starting",
				},
				now,
				15_000,
			),
		).toBe(false);
	});

	it("recovers a throttled heartbeat queue after an isolated persistence failure", async () => {
		const writes: string[] = [];
		let shouldFail = true;
		let now = 1_000;
		const reporter = createSearchIndexWorkerStateReporter({
			initialProgress: {
				currentEventCount: 0,
				stage: "starting",
			},
			minimumWriteIntervalMs: 1_000,
			now: () => new Date(now),
			write: async ({ stage }) => {
				if (shouldFail) {
					shouldFail = false;
					throw new Error("transient database failure");
				}
				writes.push(stage);
			},
		});

		await expect(
			reporter.report({ currentEventCount: 0, stage: "idle" }),
		).rejects.toThrow("transient database failure");
		now = 1_100;
		await expect(
			reporter.report({ currentEventCount: 0, stage: "retrying" }),
		).resolves.toBeUndefined();
		now = 1_200;
		await reporter.report(reporter.current(), true);
		await reporter.flush();

		expect(writes).toEqual(["retrying"]);
		expect(reporter.current().stage).toBe("retrying");
	});
});
