import { runNotificationCycle } from "../src/lib/notifications/worker";
import { runAuthorAssociationCycle } from "../src/lib/authors/association-delivery";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { setTimeout as delay } from "node:timers/promises";

import { openLibraryConfigProcess } from "../src/config/library-config/process";
import { createPostgresDatabaseResource } from "../src/db/postgres";
import { publishOutboxCommits } from "../src/lib/cache-invalidation";
import { createSupabaseFileStorage } from "../src/lib/admin/file-storage";
import {
	readPublicationWorkerInstance,
	resolvePublicationWorkerInstancePath,
	writePublicationWorkerInstance,
} from "../src/lib/publication/worker-instance";
import { runPublicationWorkerCycle } from "../src/lib/publication/worker";
import {
	failPublicationWorker,
	PublicationWorkerOwnershipLostError,
	PUBLICATION_WORKER_LEASE_SECONDS,
	registerPublicationWorker,
	stopPublicationWorker,
	type PublicationWorkerProgress,
	updatePublicationWorker,
} from "../src/lib/publication/worker-state";
import { publicationWorkerProgressSchema } from "../src/lib/publication/worker-contract";
import { createWorkerStateReporter } from "../src/lib/worker-state-reporter";

const usage =
	"Usage: npm run publication:worker -- [--watch] [--poll-ms <100-60000>] [--worker-id <id>]";

function parseCommand(args: string[]) {
	let watch = false;
	let pollMs = 1_000;
	let workerId =
		process.env.PUBLICATION_WORKER_ID?.trim() ||
		`${hostname()}:${process.pid}`;
	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--watch") {
			watch = true;
			continue;
		}
		if (argument === "--poll-ms" || argument === "--worker-id") {
			const value = args[index + 1];
			if (!value || value.startsWith("--")) throw new Error(usage);
			if (argument === "--poll-ms") pollMs = Number(value);
			else workerId = value;
			index += 1;
			continue;
		}
		throw new Error(usage);
	}
	if (
		!Number.isSafeInteger(pollMs) ||
		pollMs < 100 ||
		pollMs > 60_000 ||
		!workerId.trim() ||
		workerId.length > 220
	) {
		throw new Error(usage);
	}
	return { pollMs, watch, workerId: workerId.trim() };
}

function errorMessage(error: unknown) {
	return error instanceof Error
		? `${error.name}: ${error.message}`
		: String(error);
}

async function main() {
	const command = parseCommand(process.argv.slice(2));
	const configProcess = await openLibraryConfigProcess();
	const { abortController, config } = configProcess;
	const instanceId = randomUUID();
	const instancePath = resolvePublicationWorkerInstancePath();
	const resource = createPostgresDatabaseResource(
		config.services.database.url,
		publishOutboxCommits(config, "publication-worker"),
	);
	const storage = createSupabaseFileStorage(config.services.storage);
	let ownershipLost = false;
	let claimedJobs = 0;
	let succeededJobs = 0;
	let failedJobs = 0;
	let registered;
	try {
		registered = await registerPublicationWorker(resource.database, {
			workerId: command.workerId,
			instanceId,
			registeredAt: new Date(),
			leaseSeconds: PUBLICATION_WORKER_LEASE_SECONDS,
		});
	} catch (error) {
		await resource.dispose();
		configProcess.close();
		throw error;
	}
	const initialProgress = publicationWorkerProgressSchema.parse(
		registered.result,
	);
	try {
		await writePublicationWorkerInstance(instancePath, instanceId);
		if (
			(await readPublicationWorkerInstance(instancePath)) !== instanceId
		) {
			throw new Error(
				"Publication worker instance file could not be verified",
			);
		}
	} catch (error) {
		const failure = errorMessage(error);
		await failPublicationWorker(resource.database, {
			runId: registered.id,
			instanceId,
			claimedJobs,
			succeededJobs,
			failedJobs,
			failure,
			progress: {
				...initialProgress,
				stage: "stopped",
				lastError: failure,
			},
		});
		await resource.dispose();
		configProcess.close();
		throw error;
	}
	const reporter = createWorkerStateReporter({
		initialProgress,
		write: async (progress, heartbeatAt) => {
			await updatePublicationWorker(resource.database, {
				runId: registered.id,
				instanceId,
				heartbeatAt,
				leaseSeconds: PUBLICATION_WORKER_LEASE_SECONDS,
				claimedJobs,
				succeededJobs,
				failedJobs,
				progress,
			});
		},
	});
	const report = async (
		progress: PublicationWorkerProgress,
		force = false,
	) => {
		try {
			await reporter.report(progress, force);
		} catch (error) {
			if (error instanceof PublicationWorkerOwnershipLostError) {
				ownershipLost = true;
				abortController.abort(error);
			}
			throw error;
		}
	};
	const heartbeatTimer = setInterval(() => {
		void report(reporter.current(), true).catch((error) => {
			console.error(
				`Publication worker heartbeat failed: ${errorMessage(error)}`,
			);
		});
	}, 5_000);
	let fatalError: unknown = null;
	let consecutiveCycleFailures = 0;

	try {
		await report({ ...initialProgress, stage: "idle" }, true);
		do {
			try {
				await runAuthorAssociationCycle(resource.database, config, abortController.signal);
				const notificationError = await runNotificationCycle(resource.database, config, abortController.signal);
				const cycle = await runPublicationWorkerCycle(
					resource.database,
					config,
					storage,
					{
						workerId: command.workerId,
						signal: abortController.signal,
						onStage: async (stage) => {
							await report(
								{
									...reporter.current(),
									stage,
									currentProvider:
										stage === "crossref" ||
										stage === "zenodo"
											? stage
											: null,
								},
								true,
							);
						},
					},
				);
				claimedJobs += cycle.outcomes.length;
				succeededJobs += cycle.outcomes.filter(
					(outcome) => outcome.status === "succeeded",
				).length;
				failedJobs += cycle.outcomes.filter(
					(outcome) => outcome.status === "failed",
				).length;
				consecutiveCycleFailures = cycle.errors.length
					? consecutiveCycleFailures + 1
					: 0;
				const completedWork =
					cycle.outcomes.length > 0 || cycle.nightly === "succeeded";
				const cycleError = cycle.errors.length
					? cycle.errors
							.map(({ stage, message }) => `${stage}: ${message}`)
							.join("; ")
					: notificationError || null;
				await report(
					{
						...reporter.current(),
						stage: cycleError ? "retrying" : "idle",
						currentProvider: null,
						lastCompletedAt: completedWork
							? new Date().toISOString()
							: reporter.current().lastCompletedAt,
						lastError: cycleError,
					},
					true,
				);
				if (cycleError) console.error(cycleError);
				if (!command.watch || cycle.outcomes.length > 0 || cycleError) {
					console.log(JSON.stringify(cycle));
				}
				if (!command.watch && cycleError) throw new Error(cycleError);
			} catch (error) {
				if (abortController.signal.aborted) break;
				await report(
					{
						...reporter.current(),
						stage: "retrying",
						currentProvider: null,
						lastError: errorMessage(error),
					},
					true,
				);
				console.error(errorMessage(error));
				if (!command.watch) throw error;
			}
			if (command.watch && !abortController.signal.aborted) {
				try {
					const retryDelayMs = consecutiveCycleFailures
						? Math.min(
								60_000 * 2 ** (consecutiveCycleFailures - 1),
								3_600_000,
							)
						: command.pollMs;
					const resumeAt = Date.now() + retryDelayMs;
                    do {
                        await delay(Math.min(command.pollMs, Math.max(0, resumeAt - Date.now())), undefined, { signal: abortController.signal });
                        if (Date.now() < resumeAt && config.notifications.enabled) {
                            const notificationError = await runNotificationCycle(resource.database, config, abortController.signal);
                            if (notificationError) await report({ ...reporter.current(), lastError: notificationError }, true);
                        }
                    } while (Date.now() < resumeAt && !abortController.signal.aborted);
				} catch {
					// The process was asked to stop.
				}
			}
		} while (command.watch && !abortController.signal.aborted);
	} catch (error) {
		fatalError = error;
		throw error;
	} finally {
		clearInterval(heartbeatTimer);
		try {
			await reporter.flush();
			if (!ownershipLost) {
				const stoppedAt = new Date();
				const progress: PublicationWorkerProgress = {
					...reporter.current(),
					stage: "stopped",
					currentProvider: null,
				};
				if (fatalError) {
					await failPublicationWorker(resource.database, {
						runId: registered.id,
						instanceId,
						failedAt: stoppedAt,
						claimedJobs,
						succeededJobs,
						failedJobs,
						failure: errorMessage(fatalError),
						progress,
					});
				} else {
					await stopPublicationWorker(resource.database, {
						runId: registered.id,
						instanceId,
						stoppedAt,
						claimedJobs,
						succeededJobs,
						failedJobs,
						progress,
					});
				}
			}
		} catch (error) {
			if (!fatalError) throw error;
			console.error(
				`Publication worker cleanup failed: ${errorMessage(error)}`,
			);
		} finally {
			configProcess.close();
			await resource.dispose();
		}
	}
}

main().catch((error) => {
	console.error(errorMessage(error));
	process.exitCode = 1;
});
