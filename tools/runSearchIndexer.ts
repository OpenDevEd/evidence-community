import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { openLibraryConfigProcess } from "../src/config/library-config/process";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { installProcessFetchAbortSignal } from "../src/lib/process-fetch-signal";
import { parseSearchIndexCommand } from "../src/lib/search-index/command";
import { isIndexOnly } from "../src/lib/search-index/index-only";
import {
	prepareSearchProjection,
	readSearchEngine,
	resolveIdleLastError,
	setSearchIndexRebuildPending,
	shouldRebuildSearchIndex,
} from "../src/lib/search-index/bootstrap-state";
import {
	drainSearchOutbox,
	outboxBacklogForRebuild,
	ensureSearchIndex,
	requeueSearchOutboxDeadLetters,
	rebuildForOutboxBacklog,
	SearchOutboxAbortError,
} from "../src/lib/search-index/consumer";
import { embedderFingerprint } from "../src/lib/embedder";
import { createIndexNowNotifier } from "../src/lib/indexnow";
import { indexHoldsTheRecords, openSearchWriter } from "../src/lib/search-index/engine-setup";
import { readersEngineOnFailure, settleSearchEngine, switchRetryAt, type SettledEngine } from "../src/lib/search-index/engine-switch";
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
	// Tells search engines which records' pages changed. Never waited for: indexing goes on while a list is out.
	const indexNow = createIndexNowNotifier(config);
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
		// The index holds an index-only library's records and the database doesn't, so a rebuild would empty it.
		const leaveTheIndexAlone = async () => {
			console.log("Search index: this library is index-only, so the worker leaves its index alone");
			await writeWorkerState({ ...reporter.current(), stage: "idle" }, true);
			if (command.watch && !abortController.signal.aborted) await once(abortController.signal, "abort");
		};
		if (isIndexOnly(config)) return await leaveTheIndexAlone();
		// The engine the library's configuration chooses (OpenDevEd/new-el#722).
		const engine = await openSearchWriter(config, config.services.search.engine);
		const writer = engine.writer;
		const requeued = command.requeueDeadLetters
			? (await requeueSearchOutboxDeadLetters(databaseResource.database))
					.length
			: 0;
		let rebuildPending = await prepareSearchProjection(
			databaseResource.database,
			writer.engine,
			config.topics.enabled,
			config.search.fullText,
			config.content.tags.hidden,
			config.search.embedder ? embedderFingerprint(config.search.embedder) : null,
		);
		if (command.rebuild && !rebuildPending) {
			await setSearchIndexRebuildPending(databaseResource.database, true);
			rebuildPending = true;
		}
		const live = await readSearchEngine(databaseResource.database);
		let settled: SettledEngine;
		let embedderError: string | null;
		try {
			// The index says so itself, for a configuration that has lost the setting. Elasticsearch failing to answer takes
			// the same path as failing below, which keeps readers on the engine that works.
			if (await indexHoldsTheRecords(config)) return await leaveTheIndexAlone();
			const setup = await ensureSearchIndex(writer, {
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
			// "starting", which only needs the migrations and the library's index
			// with its settings. The embedder and a rebuild can take many minutes
			// on a large library; search answers from the existing index meanwhile.
			await writeWorkerState({ ...reporter.current(), stage: "idle" }, true);
			const prepared = await engine.prepare(abortController.signal);
			embedderError = prepared.embedderError;
			if (embedderError && prepared.indexHasRecords && (rebuildPending || command.rebuild)) {
				console.error("Search index rebuild stays pending: the embedder step failed and the existing records are kept.");
			}
			// A switch to another engine builds its index before readers move to it (OpenDevEd/new-el#722).
			settled = await settleSearchEngine({
				config,
				database: databaseResource.database,
				embedderBlocksRebuild: Boolean(embedderError && prepared.indexHasRecords),
				live,
				rebuild: shouldRebuildSearchIndex({
					embedderError,
					forceRebuild: command.rebuild,
					indexCreated: setup.created,
					indexHasRecords: prepared.indexHasRecords,
					rebuildPending,
				}),
				signal: abortController.signal,
				taskTimeoutMs: engine.rebuildTaskTimeoutMs,
				writer,
			});
		} catch (error) {
			const readersOn = readersEngineOnFailure(config, live, error, abortController.signal);
			if (!readersOn) throw error;
			embedderError = `The switch to ${writer.engine} failed, so readers stay on ${readersOn}, which this worker keeps current: ${error instanceof Error ? `${error.name}: ${error.message}` : String(error)}`;
			console.error(`Search index: ${embedderError}`);
			await writeWorkerState({ ...reporter.current(), stage: "idle" }, true);
			settled = { rebuilt: null, switchedFrom: null, oldIndexRemoved: false, readersOn };
		}
		// While a switch waits for its embedder or couldn't start, the worker ends at this time to try it again.
		const retrySwitchAt = switchRetryAt(settled.readersOn, writer.engine);
		// Changes go to the engine readers search: the old one while a switch waits for its embedder or can't start.
		const current =settled.readersOn === writer.engine ? engine : await openSearchWriter(config, settled.readersOn);
		if (settled.rebuilt) {
			console.log(
				JSON.stringify({
					deleted: settled.rebuilt.deleted,
					engine: writer.engine,
					indexed: settled.rebuilt.indexed,
					rebuild: true,
					requeued,
					...(settled.switchedFrom ? { switchedFrom: settled.switchedFrom } : {}),
					...(settled.switchedFrom || settled.oldIndexRemoved ? { oldIndexRemoved: settled.oldIndexRemoved } : {}),
				}),
			);
		}
		// The line the switch procedure waits for, also when only an old index a stopped switch left was deleted.
		if (!settled.rebuilt && settled.oldIndexRemoved) console.log(JSON.stringify({ engine: writer.engine, oldIndexRemoved: true }));
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
				current.writer,
				config,
				{ signal: abortController.signal, taskTimeoutMs: current.rebuildTaskTimeoutMs },
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
					database: databaseResource.database,
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
					writer: current.writer,
					signal: abortController.signal,
					// A drain claim can wait behind other claims' embeddings.
					taskTimeoutMs: current.rebuildTaskTimeoutMs,
					workerId: instanceId,
				});
				indexNow?.add(results.flatMap((result) => result.pageKeys));
				// Records written while the embedder failed get their vectors once it answers again. A failure here
				// leaves the drain's result standing; the next pass tries again.
				const embedded = await current.embedMissing(abortController.signal).catch((error: unknown) => {
					if (error instanceof SearchOutboxAbortError && abortController.signal.aborted) throw error;
					console.error(`Search index: embedding records without a vector failed: ${error instanceof Error ? `${error.name}: ${error.message}` : error}`);
					return 0;
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
							embedderError: embedderError ?? current.embedderError(),
							previousLastError:
								previousProgress.lastError ?? null,
							processedEvents: results.length + acknowledged + embedded,
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
			if (retrySwitchAt !== null && Date.now() >= retrySwitchAt) {
				console.log(`Search index: the worker starts over to try the switch to ${writer.engine} again.`);
				break;
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
