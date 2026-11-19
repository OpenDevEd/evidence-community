import { nightlyScheduleForDate } from "@/lib/nightly-schedule";
import { settleRecordFiles } from "@/lib/admin/record-files-nightly";
import type { CrossrefDepositor } from "@opendeved/doi-sync-core";
import { and, desc, eq, gte } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import { publicationSyncRun } from "@/db/schema/publication";
import type { EvidenceFileStorage } from "@/lib/admin/file-storage";

import { runCrossrefPublicationJobsOnce } from "./crossref-adapter";
import { runNightlyPublicationReconciliation } from "./reconciler";
import { runZenodoPublicationJobsOnce } from "./zenodo-adapter";
import type { ZenodoPublicationProvider } from "./zenodo-adapter";
import type { PublicationWorkerStage } from "./worker-contract";

type PublicationConfig = Pick<LibraryServerConfig, "identity" | "services">;

type PublicationWorkerOperations = {
	nightlyDue?: typeof publicationNightlyRunIsDue;
	reconcile?: typeof runNightlyPublicationReconciliation;
	runCrossref?: typeof runCrossrefPublicationJobsOnce;
	runZenodo?: typeof runZenodoPublicationJobsOnce;
	settleRecordFiles?: typeof settleRecordFiles;
};

export type PublicationWorkerCycleResult = {
	nightly: "busy" | "failed" | "not_due" | "succeeded";
	errors: readonly {
		stage: "reconciling" | "crossref" | "zenodo";
		message: string;
	}[];
	outcomes: readonly {
		provider: "crossref" | "zenodo";
		jobId: number;
		status: string;
	}[];
};

export const PUBLICATION_NIGHTLY_RETRY_DELAY_MS = 15 * 60 * 1_000;

function errorMessage(error: unknown) {
	return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}

function throwIfAborted(signal: AbortSignal | undefined, error: unknown) {
	if (!signal?.aborted) return;
	throw signal.reason ?? error;
}

export async function publicationNightlyRunIsDue(
	database: Database,
	config: PublicationConfig,
	now: Date,
) {
	const scheduledAt = nightlyScheduleForDate(
		config.services.publication.worker.nightlyUtcTime,
		now,
	);
	if (now.getTime() < scheduledAt.getTime()) return false;
	const [latest] = await database
		.select({
			completedAt: publicationSyncRun.completedAt,
			status: publicationSyncRun.status,
		})
		.from(publicationSyncRun)
		.where(
			and(
				eq(publicationSyncRun.trigger, "nightly"),
					gte(publicationSyncRun.completedAt, scheduledAt),
			),
		)
		.orderBy(desc(publicationSyncRun.completedAt))
		.limit(1);
	if (!latest) return true;
	if (latest.status === "succeeded") return false;
	return (
		now.getTime() - latest.completedAt!.getTime() >=
			PUBLICATION_NIGHTLY_RETRY_DELAY_MS
	);
}

/** Each night, records' files go where who may get them says (`settleRecordFiles`); a failure waits for the next night. */
async function settleRecordFilesTonight(
	database: Database,
	storage: EvidenceFileStorage,
	now: Date,
	options: { signal?: AbortSignal; operations?: PublicationWorkerOperations },
	errors: PublicationWorkerCycleResult["errors"][number][],
) {
	await (options.operations?.settleRecordFiles ?? settleRecordFiles)(database, storage, now).catch((error: unknown) => {
		throwIfAborted(options.signal, error);
		errors.push({ stage: "reconciling", message: `Record files: ${errorMessage(error)}` });
	});
}

export async function runPublicationWorkerCycle(
	database: Database,
	config: PublicationConfig,
	storage: EvidenceFileStorage,
	options: {
		workerId: string;
		now?: () => Date;
		signal?: AbortSignal;
		heartbeatIntervalMs?: number;
		crossrefProvider?: CrossrefDepositor;
		zenodoProvider?: ZenodoPublicationProvider;
		onStage?: (stage: PublicationWorkerStage) => Promise<void>;
		operations?: PublicationWorkerOperations;
	} = { workerId: `publication-worker-${process.pid}` },
): Promise<PublicationWorkerCycleResult> {
	const now = options.now ?? (() => new Date());
	let nightly: PublicationWorkerCycleResult["nightly"] = "not_due";
	const errors: PublicationWorkerCycleResult["errors"][number][] = [];
	const nightlyDue =
		options.operations?.nightlyDue ?? publicationNightlyRunIsDue;
	const reconcile =
		options.operations?.reconcile ?? runNightlyPublicationReconciliation;
	const runCrossref =
		options.operations?.runCrossref ?? runCrossrefPublicationJobsOnce;
	const runZenodo = options.operations?.runZenodo ?? runZenodoPublicationJobsOnce;
	options.signal?.throwIfAborted();
	if (await nightlyDue(database, config, now())) {
		await options.onStage?.("reconciling");
		try {
			const result = await reconcile(
				database,
				config,
				{
					workerId: options.workerId,
					leaseSeconds: config.services.publication.worker.leaseSeconds,
					now,
				},
			);
			nightly = result.status;
		} catch (error) {
			throwIfAborted(options.signal, error);
			nightly = "failed";
			errors.push({ stage: "reconciling", message: errorMessage(error) });
		}
		await settleRecordFilesTonight(database, storage, now(), options, errors);
	}

	const outcomes: PublicationWorkerCycleResult["outcomes"][number][] = [];
	options.signal?.throwIfAborted();
	if (config.services.publication.crossref.enabled) {
		await options.onStage?.("crossref");
		try {
			const crossref = await runCrossref(database, config, {
				workerId: `${options.workerId}:crossref`,
				now,
				signal: options.signal,
				heartbeatIntervalMs: options.heartbeatIntervalMs,
				provider: options.crossrefProvider,
			});
			outcomes.push(
				...crossref.map((outcome) => ({ provider: "crossref" as const, ...outcome })),
			);
		} catch (error) {
			throwIfAborted(options.signal, error);
			errors.push({ stage: "crossref", message: errorMessage(error) });
		}
	}
	options.signal?.throwIfAborted();
	if (config.services.publication.zenodo.enabled) {
		await options.onStage?.("zenodo");
		try {
			const zenodo = await runZenodo(
				database,
				config,
				storage,
				{
					workerId: `${options.workerId}:zenodo`,
					now,
					signal: options.signal,
					heartbeatIntervalMs: options.heartbeatIntervalMs,
					provider: options.zenodoProvider,
				},
			);
			outcomes.push(
				...zenodo.map((outcome) => ({ provider: "zenodo" as const, ...outcome })),
			);
		} catch (error) {
			throwIfAborted(options.signal, error);
			errors.push({ stage: "zenodo", message: errorMessage(error) });
		}
	}
	options.signal?.throwIfAborted();
	await options.onStage?.("idle");
	return { nightly, outcomes, errors };
}
