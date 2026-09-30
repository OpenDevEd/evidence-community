import { hostname } from "node:os";

import { openLibraryDatabaseProcess } from "../src/config/library-config/process";
import type { LibraryServerConfig } from "../src/config/library-config/schema";
import { reconcileConfiguredSources } from "../src/lib/source-ingestion/configuration";
import {
	releaseWorkerLeases,
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
	type SearchableCache,
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
			// Only the watching worker keeps to source schedules; a one-off run syncs everything.
			force: !command.watch,
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

type WorkerOptions = Parameters<typeof runActiveSourceConnections>[0];

/**
 * The lanes a watching worker runs beside its sweep: requested sources, and
 * status reports to OpenScholar. Stopping waits for both, then reports once
 * more, so work that finished while stopping still reaches OpenScholar.
 */
function startWatchLanes(
	config: LibraryServerConfig,
	options: WorkerOptions,
	only: string | undefined,
	/** The process stopping: no new requested runs start after it. */
	stopping: AbortSignal,
) {
	const { database } = options;
	// The reporter outlives the stop signal, to report the runs that drain.
	const reporting = new AbortController();
	const reportError = (error: unknown) =>
		console.error(`Source status could not be read: ${errorMessage(error)}`);
	const searchableCache: SearchableCache = new Map();
	const report = createSourceStatusReporter({
		...config.authentication.openScholar,
		read: () =>
			readSourceStatuses(database, { cache: searchableCache, hiddenTags: config.content.tags.hidden }),
	});
	const running = [
		runRequestedSources({
			list: () => listRunnableSourceRequests(database, { only }),
			onError: (error) => console.error(`Requested source run failed: ${errorMessage(error)}`),
			run: (sourceConnectionKey) => runSourceConnection({ ...options, sourceConnectionKey }),
			signal: stopping,
		}),
		runSourceStatusReporter({
			isActive: () => hasSourceActivity(database),
			onError: reportError,
			report,
			signal: reporting.signal,
		}),
	];
	return {
		async stop() {
			reporting.abort();
			await Promise.all(running);
			await report().catch(reportError);
		},
	};
}

/**
 * Runs again at once the sources this worker was importing when it last
 * stopped. Only for the watching worker: a one-off run started in its
 * container shares its ID and would take the leases of imports still running.
 */
async function resumeRestartedRuns(command: Command, database: WorkerOptions["database"]) {
	if (!command.watch) return;
	const released = await releaseWorkerLeases(database, command.workerId);
	if (released.length > 0) console.log(`Resuming sources stopped by a restart: ${released.join(", ")}`);
}

// An import's PDF stage reads and stages files for up to 48 PDFs at once
// while a page is written and the lease heartbeat runs, which three
// connections could not keep up with. Idle connections close after five
// seconds, so only an active import holds these.
const SOURCE_SYNC_DATABASE_CONNECTIONS = 6;

async function main() {
	const command = parseCommand(process.argv.slice(2));
	const runtimeProcess = await openLibraryDatabaseProcess({ maxConnections: SOURCE_SYNC_DATABASE_CONNECTIONS });
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
		await resumeRestartedRuns(command, database);
		const lanes = command.watch
			? startWatchLanes(config, options, command.sourceConnectionKey, abortController.signal)
			: null;
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
			await lanes?.stop();
		}
	} finally {
		await runtimeProcess.close();
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
