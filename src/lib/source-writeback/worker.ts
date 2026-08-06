import {
	runSourceWorker,
	type SourceWorkerResult,
} from "@/lib/source-ingestion/source-worker";

import {
	drainSourceWritebackJobs,
	type SourceWritebackConsumerOptions,
	type SourceWritebackProcessResult,
} from "./consumer";

export type SourceWritebackWorkerOptions = SourceWritebackConsumerOptions & {
	maxJobsPerSweep?: number;
	onError?: (error: unknown) => void;
	onSweep?: (results: SourceWritebackProcessResult[]) => void;
	pollMs?: number;
	signal: AbortSignal;
	watch?: boolean;
};

export function runSourceWritebackWorker(
	options: SourceWritebackWorkerOptions,
): Promise<SourceWorkerResult<SourceWritebackProcessResult[]>> {
	return runSourceWorker({
		onError: options.onError,
		onSweep: options.onSweep,
		pollMs: options.pollMs,
		runSweep: () =>
			drainSourceWritebackJobs(options, options.maxJobsPerSweep),
		signal: options.signal,
		watch: options.watch,
	});
}
