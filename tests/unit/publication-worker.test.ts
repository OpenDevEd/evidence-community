import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import type { publicationSyncRun } from "@/db/schema/publication";
import { nightlyScheduleForDate } from "@/lib/nightly-schedule";
import {
	runPublicationWorkerCycle,
} from "@/lib/publication/worker";
import { publicationWorkerIsReady } from "@/lib/publication/worker-state";

type PublicationRun = typeof publicationSyncRun.$inferSelect;

function workerRun(overrides: Partial<PublicationRun> = {}): PublicationRun {
	return {
		claimedJobs: 0,
		completedAt: null,
		failedJobs: 0,
		failure: null,
		heartbeatAt: new Date("2026-08-13T12:00:00.000Z"),
		id: "worker:test-instance",
		leaseExpiresAt: new Date("2026-08-13T12:15:00.000Z"),
		leaseOwner: "test-instance",
		result: {
			workerId: "publication-worker",
			instanceId: "test-instance",
			stage: "idle",
			currentProvider: null,
			lastCompletedAt: null,
			lastError: null,
		},
		startedAt: new Date("2026-08-13T11:59:00.000Z"),
		status: "running",
		succeededJobs: 0,
		trigger: "immediate",
		...overrides,
	};
}

describe("publication worker", () => {
	it("calculates the nightly UTC boundary without using local time", () => {
		expect(
			nightlyScheduleForDate(
				"02:30",
				new Date("2026-08-13T23:59:00.000-07:00"),
			).toISOString(),
		).toBe("2026-08-14T02:30:00.000Z");
		expect(() =>
			nightlyScheduleForDate("2:30", new Date()),
		).toThrow("nightlyUtcTime must use HH:mm");
	});

	it("reports readiness only for a fresh, leased worker past startup", () => {
		const now = new Date("2026-08-13T12:00:10.000Z");
		expect(publicationWorkerIsReady(workerRun(), now)).toBe(true);
		expect(
			publicationWorkerIsReady(
				workerRun({
					result: {
						workerId: "publication-worker",
						instanceId: "test-instance",
						stage: "starting",
						currentProvider: null,
						lastCompletedAt: null,
						lastError: null,
					},
				}),
				now,
			),
		).toBe(false);
		expect(
			publicationWorkerIsReady(
				workerRun({
					heartbeatAt: new Date("2026-08-13T11:59:49.999Z"),
				}),
				now,
				20_000,
			),
		).toBe(false);
		expect(
			publicationWorkerIsReady(
				workerRun({
					leaseExpiresAt: new Date("2026-08-13T12:00:10.000Z"),
				}),
				now,
			),
		).toBe(false);
	});

	it("does not claim work after shutdown starts", async () => {
		const controller = new AbortController();
		controller.abort(new Error("worker stopping"));
		await expect(
			runPublicationWorkerCycle({} as never, {} as never, {} as never, {
				workerId: "publication-worker",
				signal: controller.signal,
			}),
		).rejects.toThrow("worker stopping");
	});

	it("keeps provider delivery running when nightly reconciliation fails", async () => {
		const stages: string[] = [];
		const cycle = await runPublicationWorkerCycle(
			{} as never,
			{
				services: {
					publication: {
						crossref: { enabled: true },
						zenodo: { enabled: true },
						worker: { leaseSeconds: 30 },
					},
				},
			} as never,
			{} as never,
			{
				workerId: "publication-worker",
				onStage: async (stage) => {
					stages.push(stage);
				},
				operations: {
					nightlyDue: async () => true,
					reconcile: async () => {
						throw new Error("broken nightly record");
					},
					settleRecordFiles: async () => 0,
					runCrossref: async () => [
						{ jobId: 1, status: "succeeded" },
					],
					runZenodo: async () => [
						{ jobId: 2, status: "succeeded" },
					],
				},
			},
		);

		expect(cycle.nightly).toBe("failed");
		expect(cycle.errors).toEqual([
			{
				stage: "reconciling",
				message: "Error: broken nightly record",
			},
		]);
		expect(cycle.outcomes).toEqual([
			{ provider: "crossref", jobId: 1, status: "succeeded" },
			{ provider: "zenodo", jobId: 2, status: "succeeded" },
		]);
		expect(stages).toEqual(["reconciling", "crossref", "zenodo", "idle"]);
	});
});
