import { hostname } from "node:os";

import { openLibraryDatabaseProcess } from "../src/config/library-config/process";
import { reconcileConfiguredSources } from "../src/lib/source-ingestion/configuration";
import {
	runActiveSourceConnections,
	runSourceConnection,
	SourceLeaseUnavailableError,
	type SourceRunSweepResult,
} from "../src/lib/source-ingestion/orchestrator";
import {
	DEFAULT_SOURCE_WORKER_POLL_MS,
	runSourceWorker,
	validateSourceWorkerPollMs,
} from "../src/lib/source-ingestion/source-worker";
import { createSourceSyncRuntime } from "../src/lib/source-ingestion/runtime";
import {
	listRunnableSourceRequests,
	runRequestedSources,
} from "../src/lib/source-ingestion/run-requests";
import {
	hasSourceActivity,
	readSourceStatuses,
} from "../src/lib/source-ingestion/source-status";
import {
	createSourceStatusReporter,
	runSourceStatusReporter,
} from "../src/lib/source-ingestion/status-reporter";

const usage =
	"Usage: npm run source:sync -- [--connection <key>] [--concurrency <1-32>] [--watch] [--poll-ms <1000-3600000>] [--worker-id <id>]";

type Command = {
	concurrency: number;
	pollMs: number;
	sourceConnectionKey?: string;
	watch: boolean;
	workerId: string;
};

function requireValue(args: string[], index: number) {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(usage);
	return value;
}

function parseCommand(args: string[]): Command {
	let concurrency = 2;
	let pollMs = DEFAULT_SOURCE_WORKER_POLL_MS;
	let sourceConnectionKey: string | undefined;
	let watch = false;
	let workerId =
		process.env.SOURCE_SYNC_WORKER_ID?.trim() ||
		`${hostname()}:${process.pid}`;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--connection") {
			sourceConnectionKey = requireValue(args, index);
			index += 1;
			continue;
		}
		if (argument === "--concurrency") {
			concurrency = Number(requireValue(args, index));
			index += 1;
			continue;
		}
		if (argument === "--watch") {
			watch = true;
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
		throw new Error(usage);
	}

	if (
		!Number.isSafeInteger(concurrency) ||
		concurrency < 1 ||
		concurrency > 32
	) {
		throw new Error(usage);
	}
	try {
		validateSourceWorkerPollMs(pollMs);
	} catch {
		throw new Error(usage);
	}
	return { concurrency, pollMs, sourceConnectionKey, watch, workerId };
}

function errorMessage(error: unknown) {
	return error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error);
}

async function runConfiguredSweep(
	command: Command,
	options: Parameters<typeof runActiveSourceConnections>[0],
): Promise<SourceRunSweepResult[]> {
	if (!command.sourceConnectionKey) {
		return runActiveSourceConnections({
			...options,
			concurrency: command.concurrency,
		});
	}
	try {
		return [
			await runSourceConnection({
				...options,
				sourceConnectionKey: command.sourceConnectionKey,
			}),
		];
	} catch (error) {
		if (error instanceof SourceLeaseUnavailableError) {
			return [
				{
					connectionKey: command.sourceConnectionKey,
					status: "busy",
				},
			];
		}
		return [
			{
				connectionKey: command.sourceConnectionKey,
				error: errorMessage(error),
				status: "failed",
			},
		];
	}
}

async function main() {
	const command = parseCommand(process.argv.slice(2));
	const runtimeProcess = await openLibraryDatabaseProcess();
	const { abortController, config, databaseResource } = runtimeProcess;
	try {
		await reconcileConfiguredSources(
			databaseResource.database,
			config.sources,
		);
		const runtime = createSourceSyncRuntime(
			config,
			databaseResource.database,
		);
		const database = databaseResource.database;
		const options = {
			credentialResolver: runtime.credentialResolver,
			database,
			registry: runtime.registry,
			workerId: command.workerId,
		};
		// A watching worker also runs requested sources and keeps OpenScholar's
		// view current. The lanes stop with the worker, before the database closes.
		const lanes = new AbortController();
		const stopLanes = () => lanes.abort();
		abortController.signal.addEventListener("abort", stopLanes, { once: true });
		const background = command.watch
			? [
					runRequestedSources({
						list: () => listRunnableSourceRequests(database, { only: command.sourceConnectionKey }),
						onError: (error) => console.error(`Requested source run failed: ${errorMessage(error)}`),
						run: (sourceConnectionKey) => runSourceConnection({ ...options, sourceConnectionKey }),
						signal: lanes.signal,
					}),
					runSourceStatusReporter({
						isActive: () => hasSourceActivity(database),
						onError: (error) => console.error(`Source status could not be read: ${errorMessage(error)}`),
						report: createSourceStatusReporter({
							...config.authentication.openScholar,
							read: () =>
								readSourceStatuses(database, { hiddenTags: config.content.tags.hidden }),
						}),
						signal: lanes.signal,
					}),
				]
			: [];
		try {
			const result = await runSourceWorker({
				onError: (error) => console.error(errorMessage(error)),
				onSweep: (sweep) => console.log(JSON.stringify(sweep, null, 2)),
				pollMs: command.pollMs,
				runSweep: () => runConfiguredSweep(command, options),
				signal: abortController.signal,
				watch: command.watch,
			});
			if (
				!command.watch &&
				result.lastSweep?.some((entry) => entry.status === "failed")
			) {
				process.exitCode = 1;
			}
		} finally {
			stopLanes();
			abortController.signal.removeEventListener("abort", stopLanes);
			await Promise.all(background);
		}
	} finally {
		await runtimeProcess.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
