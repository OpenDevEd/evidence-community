import { setTimeout as delay } from "node:timers/promises";

import type { SourceRunSweepResult } from "./orchestrator";

export const DEFAULT_SOURCE_WORKER_POLL_MS = 60_000;
export const MIN_SOURCE_WORKER_POLL_MS = 1_000;
export const MAX_SOURCE_WORKER_POLL_MS = 60 * 60 * 1_000;
/** How often an idle worker checks whether someone asked for a run now. */
const RUN_REQUEST_CHECK_MS = 5_000;

type SourceWorkerDelay = (
	milliseconds: number,
	signal: AbortSignal,
) => Promise<void>;

export type SourceWorkerOptions<TResult = SourceRunSweepResult[]> = {
	delay?: SourceWorkerDelay;
	onError?: (error: unknown) => void;
	onSweep?: (results: TResult) => void;
	pollMs?: number;
	/** Whether someone asked for a run now; checked while the worker waits. */
	runRequested?: () => Promise<boolean>;
	runSweep: () => Promise<TResult>;
	signal: AbortSignal;
	watch?: boolean;
};

export type SourceWorkerResult<TResult = SourceRunSweepResult[]> = {
	lastSweep: TResult | null;
	sweeps: number;
};

export function validateSourceWorkerPollMs(value: number) {
	if (
		!Number.isSafeInteger(value) ||
		value < MIN_SOURCE_WORKER_POLL_MS ||
		value > MAX_SOURCE_WORKER_POLL_MS
	) {
		throw new Error(
			`pollMs must be an integer between ${MIN_SOURCE_WORKER_POLL_MS} and ${MAX_SOURCE_WORKER_POLL_MS}`,
		);
	}
	return value;
}

async function defaultDelay(milliseconds: number, signal: AbortSignal) {
	await delay(milliseconds, undefined, { signal });
}

/** Waits out the poll interval, ending early when a run is requested. */
async function waitForNextSweep(
	pollMs: number,
	wait: SourceWorkerDelay,
	options: Pick<SourceWorkerOptions<unknown>, "runRequested" | "signal">,
) {
	if (!options.runRequested) return wait(pollMs, options.signal);
	for (let waited = 0; waited < pollMs; ) {
		const step = Math.min(RUN_REQUEST_CHECK_MS, pollMs - waited);
		await wait(step, options.signal);
		waited += step;
		if (await options.runRequested()) return;
	}
}

export async function runSourceWorker<TResult = SourceRunSweepResult[]>(
	options: SourceWorkerOptions<TResult>,
): Promise<SourceWorkerResult<TResult>> {
	const watch = options.watch ?? false;
	const pollMs = validateSourceWorkerPollMs(
		options.pollMs ?? DEFAULT_SOURCE_WORKER_POLL_MS,
	);
	const wait = options.delay ?? defaultDelay;
	let lastSweep: TResult | null = null;
	let sweeps = 0;

	while (!options.signal.aborted) {
		try {
			lastSweep = await options.runSweep();
			sweeps += 1;
			options.onSweep?.(lastSweep);
		} catch (error) {
			sweeps += 1;
			if (!watch) throw error;
			options.onError?.(error);
		}

		if (!watch || options.signal.aborted) break;
		try {
			await waitForNextSweep(pollMs, wait, options);
		} catch (error) {
			if (!options.signal.aborted) throw error;
		}
	}

	return { lastSweep, sweeps };
}
