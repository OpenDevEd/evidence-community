import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { loadLibraryConfig } from "../src/config/library-config/source";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { RevisionAwareMeilisearchFactory } from "../src/lib/meilisearch-factory";
import { installProcessFetchAbortSignal } from "../src/lib/process-fetch-signal";
import {
	drainSearchOutbox,
	ensureSearchIndex,
	requeueSearchOutboxDeadLetters,
	rebuildSearchIndex,
	SearchOutboxAbortError,
} from "../src/lib/search-index/consumer";
import {
	createSearchIndexWorkerStateReporter,
	registerSearchIndexWorker,
	SearchIndexWorkerOwnershipLostError,
	stopSearchIndexWorker,
	type SearchIndexWorkerProgress,
	updateSearchIndexWorker,
} from "../src/lib/search-index/worker-state";
import {
	resolveSearchIndexWorkerInstancePath,
	writeSearchIndexWorkerInstance,
} from "../src/lib/search-index/worker-instance";

const usage =
	"Usage: npm run search:index -- [--rebuild] [--requeue-dead-letters] [--watch] [--max-events <1-1000000>] [--poll-ms <100-60000>] [--worker-id <id>]";

type Command = {
	maxEvents: number;
	pollMs: number;
	rebuild: boolean;
	requeueDeadLetters: boolean;
	watch: boolean;
	workerId: string;
};

function requireValue(args: string[], index: number) {
	const value = args[index + 1];
	if (!value || value.startsWith("--")) throw new Error(usage);
	return value;
}

function parseCommand(args: string[]): Command {
	let maxEvents = 10_000;
	let pollMs = 1_000;
	let rebuild = false;
	let requeueDeadLetters = false;
	let watch = false;
	let workerId =
		process.env.SEARCH_INDEX_WORKER_ID?.trim() ||
		`${hostname()}:${process.pid}`;

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
		throw new Error(usage);
	}
	if (!Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 60_000) {
		throw new Error(usage);
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

async function main() {
	const command = parseCommand(process.argv.slice(2));
	const config = await loadLibraryConfig();
	const instanceId = randomUUID();
	await writeSearchIndexWorkerInstance(
		resolveSearchIndexWorkerInstancePath(),
		instanceId,
	);
	const databaseResource = createPostgresDatabaseResource(
		config.services.database.url,
	);
	const abortController = new AbortController();
	let ownershipLost = false;
	const stop = () => abortController.abort();
	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);
	let registeredWorker;
	try {
		registeredWorker = await registerSearchIndexWorker(
			databaseResource.database,
			command.workerId,
			instanceId,
		);
	} catch (error) {
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		await databaseResource.dispose();
		throw error;
	}
	const initialProgress: SearchIndexWorkerProgress = {
		currentBatchProgress: null as number | null,
		currentBatchUid: null as number | null,
		currentEventCount: 0,
		currentTaskUid: null as number | null,
		lastCompletedAt: registeredWorker.lastCompletedAt,
		lastError: registeredWorker.lastError,
		stage: "starting",
	};
	const reporter = createSearchIndexWorkerStateReporter({
		initialProgress,
		write: async (progress, heartbeatAt) => {
			await updateSearchIndexWorker(
				databaseResource.database,
				command.workerId,
				instanceId,
				progress,
				heartbeatAt,
			);
		},
	});
	const writeWorkerState = async (
		progress: SearchIndexWorkerProgress,
		force = false,
	) => {
		try {
			await reporter.report(progress, force);
		} catch (error) {
			if (error instanceof SearchIndexWorkerOwnershipLostError) {
				ownershipLost = true;
				abortController.abort();
				throw new SearchOutboxAbortError();
			}
			throw error;
		}
	};
	const heartbeatTimer = setInterval(() => {
		void writeWorkerState(reporter.current(), true).catch((error) => {
			console.error(
				`Search index worker heartbeat failed: ${error instanceof Error ? error.message : error}`,
			);
		});
	}, 5_000);
	const restoreFetch = installProcessFetchAbortSignal(abortController.signal);

	try {
		const meilisearchFactory = new RevisionAwareMeilisearchFactory();
		const service = await meilisearchFactory.get({
			configuration: config.services.search,
			revision: config.revision,
			updatedAt: config.updatedAt,
		});
		const requeued = command.requeueDeadLetters
			? (
					await requeueSearchOutboxDeadLetters(
						databaseResource.database,
					)
				).length
			: 0;
		if (command.rebuild) {
			const plan = await rebuildSearchIndex(
				databaseResource.database,
				service,
				{ signal: abortController.signal },
			);
			console.log(
				JSON.stringify({
					deleted: plan.deleted,
					indexed: plan.indexed,
					rebuild: true,
					requeued,
				}),
			);
		} else {
			await ensureSearchIndex(service, {
				signal: abortController.signal,
			});
		}
		await writeWorkerState(
			{
				currentBatchProgress: null,
				currentBatchUid: null,
				currentEventCount: 0,
				currentTaskUid: null,
				lastCompletedAt: registeredWorker.lastCompletedAt,
				lastError: registeredWorker.lastError,
				stage: "idle",
			},
			true,
		);

		do {
			try {
				const results = await drainSearchOutbox({
					batchClient: service.client.batches,
					database: databaseResource.database,
					index: service.index,
					maxEvents: command.maxEvents,
					onProgress: async (progress) => {
						try {
							await writeWorkerState(
								{
									currentBatchProgress:
										progress.batchProgress,
									currentBatchUid: progress.batchUid,
									currentEventCount: progress.eventIds.length,
									currentTaskUid: progress.taskUid,
									lastCompletedAt:
										reporter.current().lastCompletedAt ??
										null,
									lastError:
										reporter.current().lastError ?? null,
									stage: progress.stage,
								},
								progress.stage !== reporter.current().stage,
							);
						} catch (error) {
							if (error instanceof SearchOutboxAbortError)
								throw error;
							console.error(
								`Search index worker progress update failed: ${error instanceof Error ? error.message : error}`,
							);
						}
					},
					signal: abortController.signal,
					workerId: instanceId,
				});
				const previousProgress = reporter.current();
				await writeWorkerState(
					{
						currentBatchProgress: null,
						currentBatchUid: null,
						currentEventCount: 0,
						currentTaskUid: null,
						lastCompletedAt:
							results.length > 0
								? new Date()
								: (previousProgress.lastCompletedAt ?? null),
						lastError:
							results.length > 0
								? null
								: previousProgress.lastError,
						stage: "idle",
					},
					true,
				);
				if (results.length > 0 || !command.watch) {
					console.log(
						JSON.stringify({
							processed: results.reduce(
								(total, result) =>
									total + result.eventIds.length,
								0,
							),
							rebuild: false,
							requeued,
						}),
					);
				}
			} catch (error) {
				if (
					error instanceof SearchOutboxAbortError &&
					abortController.signal.aborted
				) {
					break;
				}
				await writeWorkerState(
					{
						currentBatchProgress: null,
						currentBatchUid: null,
						currentEventCount: 0,
						currentTaskUid: null,
						lastCompletedAt:
							reporter.current().lastCompletedAt ?? null,
						lastError:
							error instanceof Error
								? `${error.name}: ${error.message}`
								: String(error),
						stage: "retrying",
					},
					true,
				);
				console.error(error instanceof Error ? error.message : error);
				if (!command.watch) throw error;
			}
			if (command.watch && !abortController.signal.aborted) {
				try {
					await delay(command.pollMs, undefined, {
						signal: abortController.signal,
					});
				} catch {
					// The process was asked to stop.
				}
			}
		} while (command.watch && !abortController.signal.aborted);
	} catch (error) {
		if (!abortController.signal.aborted && !ownershipLost) {
			await writeWorkerState(
				{
					currentBatchProgress: null,
					currentBatchUid: null,
					currentEventCount: 0,
					currentTaskUid: null,
					lastCompletedAt: reporter.current().lastCompletedAt ?? null,
					lastError:
						error instanceof Error
							? `${error.name}: ${error.message}`
							: String(error),
					stage: "retrying",
				},
				true,
			);
		}
		if (!abortController.signal.aborted && !ownershipLost) throw error;
	} finally {
		restoreFetch();
		clearInterval(heartbeatTimer);
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
		try {
			await reporter.flush();
			if (!ownershipLost) {
				await writeWorkerState(
					{
						currentBatchProgress: null,
						currentBatchUid: null,
						currentEventCount: 0,
						currentTaskUid: null,
						lastCompletedAt:
							reporter.current().lastCompletedAt ?? null,
						lastError: reporter.current().lastError ?? null,
						stage: "stopping",
					},
					true,
				);
				await stopSearchIndexWorker(
					databaseResource.database,
					command.workerId,
					instanceId,
				);
			}
		} catch (error) {
			if (
				!(error instanceof SearchIndexWorkerOwnershipLostError) &&
				!(error instanceof SearchOutboxAbortError && ownershipLost)
			) {
				throw error;
			}
		} finally {
			await databaseResource.dispose();
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
