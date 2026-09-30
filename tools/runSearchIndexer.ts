import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { openLibraryConfigProcess } from "../src/config/library-config/process";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { RevisionAwareMeilisearchFactory } from "../src/lib/meilisearch-factory";
import { installProcessFetchAbortSignal } from "../src/lib/process-fetch-signal";
import { parseSearchIndexCommand } from "../src/lib/search-index/command";
import {
	prepareSearchProjection,
	resolveIdleLastError,
	resolveRebuildTaskTimeoutMs,
	setSearchIndexRebuildPending,
	shouldRebuildSearchIndex,
} from "../src/lib/search-index/bootstrap-state";
import {
	drainSearchOutbox,
	outboxBacklogForRebuild,
	applySearchIndexEmbedder,
	ensureSearchIndex,
	requeueSearchOutboxDeadLetters,
	rebuildForOutboxBacklog,
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

async function main() {
	const command = parseSearchIndexCommand(
		process.argv.slice(2),
		process.env.SEARCH_INDEX_WORKER_ID?.trim() ||
			`${hostname()}:${process.pid}`,
	);
	const configProcess = await openLibraryConfigProcess();
	const { abortController, config } = configProcess;
	const instanceId = randomUUID();
	await writeSearchIndexWorkerInstance(
		resolveSearchIndexWorkerInstancePath(),
		instanceId,
	);
	// Three drain lanes each hold a projection transaction and, with topics
	// on, a catalog connection; heartbeats and worker state need the rest.
	const databaseResource = createPostgresDatabaseResource(
		config.services.database.url,
		8,
	);
	let ownershipLost = false;
	let registeredWorker;
	try {
		registeredWorker = await registerSearchIndexWorker(
			databaseResource.database,
			command.workerId,
			instanceId,
		);
	} catch (error) {
		await databaseResource.dispose();
		configProcess.close();
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
			? (await requeueSearchOutboxDeadLetters(databaseResource.database))
					.length
			: 0;
		let rebuildPending = await prepareSearchProjection(
			databaseResource.database,
			config.topics.enabled,
			config.search.fullText,
			config.content.tags.hidden,
		);
		if (command.rebuild && !rebuildPending) {
			await setSearchIndexRebuildPending(databaseResource.database, true);
			rebuildPending = true;
		}
		// Deep result pages are fast only on Meilisearch's legacy search path
		// (MEILI_EXPERIMENTAL_LEGACY_SEARCH, which a stored flag can override).
		const features = await service.client.getExperimentalFeatures();
		if ((features as { legacySearch?: boolean | null }).legacySearch !== true) {
			console.warn(
				"Search index: Meilisearch's legacy search path is off, so deep result pages will be slow. Set MEILI_EXPERIMENTAL_LEGACY_SEARCH=true and check GET /experimental-features.",
			);
		}
		const setup = await ensureSearchIndex(service, {
			onMissing: async () => {
				await setSearchIndexRebuildPending(
					databaseResource.database,
					true,
				);
				rebuildPending = true;
			},
			signal: abortController.signal,
		});
		// The site and the other workers wait for this worker to leave
		// "starting", which only needs the migrations and the index with its
		// settings, so a new sort field works. The embedder and rebuild below
		// can take many minutes on a large library; search answers from the
		// existing records meanwhile.
		await writeWorkerState({ ...reporter.current(), stage: "idle" }, true);
		let embedderError: string | null = null;
		try {
			// The worker reads as idle here. The stored worker state cannot
			// describe a settings task (it requires outbox events for
			// "waiting"/"indexing"), so progress goes to the log instead.
			let lastEmbedderStage = "";
			await applySearchIndexEmbedder(service, config.search.embedder, {
				batchClient: service.client.batches,
				onProgress: async (progress) => {
					const line = `${progress.stage} task ${progress.taskUid ?? "?"}${
						progress.batchProgress === null
							? ""
							: ` ${progress.batchProgress}%`
					}`;
					if (line === lastEmbedderStage) return;
					lastEmbedderStage = line;
					console.log(`Search index embedder: ${line}`);
				},
				signal: abortController.signal,
			});
			console.log(
				config.search.embedder
					? "Search index embedder: ready"
					: "Search index embedder: removed",
			);
		} catch (error) {
			if (
				error instanceof SearchOutboxAbortError &&
				abortController.signal.aborted
			) {
				throw error;
			}
			// A broken embedder must not stop record indexing. The next worker
			// start retries it, and Similar Resources stays unavailable until then.
			embedderError =
				error instanceof Error
					? `${error.name}: ${error.message}`
					: String(error);
			console.error(`Search index embedder failed: ${embedderError}`);
		}
		const indexHasRecords = embedderError
			? (await service.index.getStats()).numberOfDocuments > 0
			: false;
		if (
			embedderError &&
			indexHasRecords &&
			(rebuildPending || command.rebuild)
		) {
			console.error(
				"Search index rebuild stays pending: the embedder step failed and the existing records are kept.",
			);
		}
		if (
			shouldRebuildSearchIndex({
				embedderError,
				forceRebuild: command.rebuild,
				indexCreated: setup.created,
				indexHasRecords,
				rebuildPending,
			})
		) {
			const plan = await rebuildSearchIndex(
				databaseResource.database,
				service,
				config,
				{
					signal: abortController.signal,
					taskTimeoutMs: resolveRebuildTaskTimeoutMs({
						embedder: config.search.embedder,
					}),
				},
			);
			await setSearchIndexRebuildPending(
				databaseResource.database,
				false,
			);
			console.log(
				JSON.stringify({
					deleted: plan.deleted,
					indexed: plan.indexed,
					rebuild: true,
					requeued,
				}),
			);
		}
		await writeWorkerState(
			{
				currentBatchProgress: null,
				currentBatchUid: null,
				currentEventCount: 0,
				currentTaskUid: null,
				lastCompletedAt: registeredWorker.lastCompletedAt,
				// Startup finished, so a previous run's error is gone; only a
				// failed embedder from this run stays visible.
				lastError: embedderError,
				stage: "idle",
			},
			true,
		);

		let backlogRebuildFailed = false;
		const rebuildLargeBacklog = async () => {
			const backlog = await outboxBacklogForRebuild(databaseResource.database);
			if (backlog === 0) return 0;
			await writeWorkerState(
				{
					currentBatchProgress: null,
					currentBatchUid: null,
					currentEventCount: backlog,
					currentTaskUid: null,
					lastCompletedAt: reporter.current().lastCompletedAt ?? null,
					lastError: reporter.current().lastError ?? null,
					stage: "projecting",
				},
				true,
			);
			const rebuilt = await rebuildForOutboxBacklog(
				databaseResource.database,
				service,
				config,
				{
					signal: abortController.signal,
					taskTimeoutMs: resolveRebuildTaskTimeoutMs({
						embedder: config.search.embedder,
					}),
				},
			);
			console.log(JSON.stringify({ ...rebuilt, rebuild: "backlog" }));
			return rebuilt.acknowledged;
		};
		do {
			try {
				// A large backlog, such as a first import, is indexed faster by
				// a rebuild; events written meanwhile are drained below. After a
				// failed backlog rebuild only the drain runs, because only the
				// drain can set a rejected document aside.
				let acknowledged = 0;
				if (!backlogRebuildFailed) {
					try {
						acknowledged = await rebuildLargeBacklog();
					} catch (error) {
						if (
							error instanceof SearchOutboxAbortError &&
							abortController.signal.aborted
						) {
							throw error;
						}
						backlogRebuildFailed = true;
						console.error(
							`Search index backlog rebuild failed; draining instead: ${error instanceof Error ? `${error.name}: ${error.message}` : error}`,
						);
					}
				}
				const results = await drainSearchOutbox({
					config,
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
					// A drain claim can wait behind other claims' embeddings.
					taskTimeoutMs: resolveRebuildTaskTimeoutMs({
						embedder: config.search.embedder,
					}),
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
							results.length + acknowledged > 0
								? new Date()
								: (previousProgress.lastCompletedAt ?? null),
						lastError: resolveIdleLastError({
							embedderError,
							previousLastError:
								previousProgress.lastError ?? null,
							processedEvents: results.length + acknowledged,
						}),
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
			configProcess.close();
			await databaseResource.dispose();
		}
	}
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
