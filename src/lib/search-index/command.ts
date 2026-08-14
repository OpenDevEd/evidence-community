export const SEARCH_INDEX_USAGE =
	"Usage: npm run search:index -- [--rebuild] [--requeue-dead-letters] [--watch] [--max-events <1-1000000>] [--poll-ms <100-60000>] [--worker-id <id>]";

export type SearchIndexCommand = {
	maxEvents: number;
	pollMs: number;
	rebuild: boolean;
	requeueDeadLetters: boolean;
	watch: boolean;
	workerId: string;
};

function requireValue(args: readonly string[], index: number) {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(SEARCH_INDEX_USAGE);
	return value;
}

export function parseSearchIndexCommand(
	args: readonly string[],
	defaultWorkerId: string,
): SearchIndexCommand {
	let maxEvents = 10_000;
	let pollMs = 1_000;
	let rebuild = false;
	let requeueDeadLetters = false;
	let watch = false;
	let workerId = defaultWorkerId;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--rebuild") {
			rebuild = true;
			continue;
		}
		if (argument === "--watch") {
			watch = true;
			continue;
		}
		if (argument === "--requeue-dead-letters") {
			requeueDeadLetters = true;
			continue;
		}
		if (argument === "--max-events") {
			maxEvents = Number(requireValue(args, index));
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
		throw new Error(SEARCH_INDEX_USAGE);
	}

	workerId = workerId.trim();
	if (
		!Number.isSafeInteger(maxEvents) ||
		maxEvents < 1 ||
		maxEvents > 1_000_000 ||
		!Number.isSafeInteger(pollMs) ||
		pollMs < 100 ||
		pollMs > 60_000 ||
		workerId.length < 1 ||
		workerId.length > 255
	) {
		throw new Error(SEARCH_INDEX_USAGE);
	}

	return {
		maxEvents,
		pollMs,
		rebuild,
		requeueDeadLetters,
		watch,
		workerId,
	};
}
