import { describe, expect, it, vi } from "vitest";

import type { SourceRunSweepResult } from "@/lib/source-ingestion/orchestrator";
import {
	runSourceWorker,
	validateSourceWorkerPollMs,
} from "@/lib/source-ingestion/source-worker";

const succeeded: SourceRunSweepResult = {
	connectionKey: "zotero-test",
	provider: "zotero",
	result: {
		collections: 0,
		items: 0,
		records: 0,
		targetVersion: "1",
	},
	runId: 1,
	status: "succeeded",
};

describe("source worker", () => {
	it("runs exactly one sweep outside watch mode", async () => {
		const controller = new AbortController();
		const runSweep = vi.fn(async () => [succeeded]);
		const wait = vi.fn(async () => undefined);

		const result = await runSourceWorker({
			delay: wait,
			runSweep,
			signal: controller.signal,
		});

		expect(result).toEqual({ lastSweep: [succeeded], sweeps: 1 });
		expect(runSweep).toHaveBeenCalledTimes(1);
		expect(wait).not.toHaveBeenCalled();
	});

	it("never overlaps watched sweeps", async () => {
		const controller = new AbortController();
		let activeSweeps = 0;
		let maximumActiveSweeps = 0;
		const runSweep = vi.fn(async () => {
			activeSweeps += 1;
			maximumActiveSweeps = Math.max(maximumActiveSweeps, activeSweeps);
			await Promise.resolve();
			activeSweeps -= 1;
			if (runSweep.mock.calls.length === 3) controller.abort();
			return [succeeded];
		});
		const wait = vi.fn(async () => undefined);

		const result = await runSourceWorker({
			delay: wait,
			pollMs: 1_000,
			runSweep,
			signal: controller.signal,
			watch: true,
		});

		expect(result.sweeps).toBe(3);
		expect(maximumActiveSweeps).toBe(1);
		expect(wait).toHaveBeenCalledTimes(2);
	});

	it("continues after a watched sweep-level failure", async () => {
		const controller = new AbortController();
		const failure = new Error("database unavailable");
		const errors: unknown[] = [];
		const runSweep = vi
			.fn<() => Promise<SourceRunSweepResult[]>>()
			.mockRejectedValueOnce(failure)
			.mockImplementationOnce(async () => {
				controller.abort();
				return [succeeded];
			});

		const result = await runSourceWorker({
			delay: async () => undefined,
			onError: (error) => errors.push(error),
			pollMs: 1_000,
			runSweep,
			signal: controller.signal,
			watch: true,
		});

		expect(result).toEqual({ lastSweep: [succeeded], sweeps: 2 });
		expect(errors).toEqual([failure]);
	});

	it("stops immediately when polling is aborted", async () => {
		const controller = new AbortController();
		const runSweep = vi.fn(async () => [succeeded]);
		const wait = vi.fn(
			async (_milliseconds: number, signal: AbortSignal) => {
				controller.abort();
				throw signal.reason;
			},
		);

		const result = await runSourceWorker({
			delay: wait,
			pollMs: 1_000,
			runSweep,
			signal: controller.signal,
			watch: true,
		});

		expect(result.sweeps).toBe(1);
		expect(runSweep).toHaveBeenCalledTimes(1);
	});

	it("propagates one-shot failures", async () => {
		const controller = new AbortController();
		await expect(
			runSourceWorker({
				runSweep: async () => {
					throw new Error("database unavailable");
				},
				signal: controller.signal,
			}),
		).rejects.toThrow("database unavailable");
	});

	it("validates the documented polling bounds", () => {
		expect(validateSourceWorkerPollMs(1_000)).toBe(1_000);
		expect(validateSourceWorkerPollMs(3_600_000)).toBe(3_600_000);
		expect(() => validateSourceWorkerPollMs(999)).toThrow(/between 1000/u);
		expect(() => validateSourceWorkerPollMs(3_600_001)).toThrow(
			/between 1000/u,
		);
		expect(() => validateSourceWorkerPollMs(Number.NaN)).toThrow(
			/between 1000/u,
		);
	});
});
