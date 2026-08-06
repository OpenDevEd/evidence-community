import { setTimeout as delay } from "node:timers/promises";

import type { SourceRunSweepResult } from "./orchestrator";

export const DEFAULT_SOURCE_SYNC_POLL_MS = 60_000;
export const MIN_SOURCE_SYNC_POLL_MS = 1_000;
export const MAX_SOURCE_SYNC_POLL_MS = 60 * 60 * 1_000;

type SourceWorkerDelay = (
	milliseconds: number,
	signal: AbortSignal,
) => Promise<void>;

export type SourceWorkerOptions = {
	delay?: SourceWorkerDelay;
	onError?: (error: unknown) => void;
	onSweep?: (results: SourceRunSweepResult[]) => void;
	pollMs?: number;
	runSweep: () => Promise<SourceRunSweepResult[]>;
	signal: AbortSignal;
	watch?: boolean;
};

export type SourceWorkerResult = {
	lastSweep: SourceRunSweepResult[] | null;
	sweeps: number;
};

export function validateSourceSyncPollMs(value: number) {
	if (
		!Number.isSafeInteger(value) ||
		value < MIN_SOURCE_SYNC_POLL_MS ||
		value > MAX_SOURCE_SYNC_POLL_MS
	) {
		throw new Error(
			`pollMs must be an integer between ${MIN_SOURCE_SYNC_POLL_MS} and ${MAX_SOURCE_SYNC_POLL_MS}`,
		);
	}
	return value;
}

async function defaultDelay(milliseconds: number, signal: AbortSignal) {
	await delay(milliseconds, undefined, { signal });
}

export async function runSourceWorker(
	options: SourceWorkerOptions,
): Promise<SourceWorkerResult> {
	const watch = options.watch ?? false;
	const pollMs = validateSourceSyncPollMs(
		options.pollMs ?? DEFAULT_SOURCE_SYNC_POLL_MS,
	);
	const wait = options.delay ?? defaultDelay;
	let lastSweep: SourceRunSweepResult[] | null = null;
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
			await wait(pollMs, options.signal);
		} catch (error) {
			if (!options.signal.aborted) throw error;
		}
	}

	return { lastSweep, sweeps };
}
