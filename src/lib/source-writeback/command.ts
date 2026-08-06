import {
	DEFAULT_SOURCE_WORKER_POLL_MS,
	validateSourceWorkerPollMs,
} from "@/lib/source-ingestion/source-worker";

import {
	DEFAULT_SOURCE_WRITEBACK_MAX_JOBS,
	validateSourceWritebackMaxJobs,
	validateSourceWritebackWorkerId,
} from "./consumer";

export const SOURCE_WRITEBACK_USAGE =
	"Usage: npm run source:writeback -- [--watch] [--max-jobs <1-1000000>] [--poll-ms <1000-3600000>] [--worker-id <id>]";

export type SourceWritebackCommand = {
	maxJobsPerSweep: number;
	pollMs: number;
	watch: boolean;
	workerId: string;
};

function requireValue(args: readonly string[], index: number) {
	const value = args[index + 1];
	if (!value || value.startsWith("--"))
		throw new Error(SOURCE_WRITEBACK_USAGE);
	return value;
}

export function parseSourceWritebackCommand(
	args: readonly string[],
	defaultWorkerId: string,
): SourceWritebackCommand {
	let maxJobsPerSweep = DEFAULT_SOURCE_WRITEBACK_MAX_JOBS;
	let pollMs = DEFAULT_SOURCE_WORKER_POLL_MS;
	let watch = false;
	let workerId = defaultWorkerId;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--watch") {
			watch = true;
			continue;
		}
		if (argument === "--max-jobs") {
			maxJobsPerSweep = Number(requireValue(args, index));
			index += 1;
			continue;
		}
		if (argument === "--poll-ms") {
			pollMs = Number(requireValue(args, index));
			index += 1;
			continue;
		}
		if (argument === "--worker-id") {
			workerId = requireValue(args, index);
			index += 1;
			continue;
		}
		throw new Error(SOURCE_WRITEBACK_USAGE);
	}

	try {
		return {
			maxJobsPerSweep: validateSourceWritebackMaxJobs(maxJobsPerSweep),
			pollMs: validateSourceWorkerPollMs(pollMs),
			watch,
			workerId: validateSourceWritebackWorkerId(workerId),
		};
	} catch {
		throw new Error(SOURCE_WRITEBACK_USAGE);
	}
}
