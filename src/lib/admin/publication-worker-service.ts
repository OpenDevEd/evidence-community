import { and, asc, desc, eq, gt, isNotNull, isNull } from "drizzle-orm";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { Database } from "@/db/database-schema";
import {
	publicationSyncJob,
	publicationSyncRun,
} from "@/db/schema/publication";
import {
	publicationWorkerIsReady,
} from "@/lib/publication/worker-state";
import { publicationWorkerProgressSchema } from "@/lib/publication/worker-contract";

export async function getAdminPublicationWorkerOverview(
	database: Database,
	config: Pick<LibraryServerConfig, "services">,
	now = new Date(),
) {
	const [runs, pending, failed, currentJobs] = await Promise.all([
		database
			.select()
			.from(publicationSyncRun)
			.where(
				and(
					eq(publicationSyncRun.trigger, "immediate"),
					isNotNull(publicationSyncRun.result),
					isNotNull(publicationSyncRun.heartbeatAt),
				),
			)
			.orderBy(desc(publicationSyncRun.heartbeatAt), desc(publicationSyncRun.startedAt))
			.limit(1),
		database
			.select({ nextAttemptAt: publicationSyncJob.nextAttemptAt })
			.from(publicationSyncJob)
			.where(
				and(
					isNull(publicationSyncJob.processedAt),
					isNull(publicationSyncJob.deadLetteredAt),
					isNull(publicationSyncJob.supersededAt),
				),
			)
			.orderBy(asc(publicationSyncJob.nextAttemptAt), asc(publicationSyncJob.id))
			.limit(1),
		database
			.select({ id: publicationSyncJob.id })
			.from(publicationSyncJob)
			.where(
				and(
					isNull(publicationSyncJob.processedAt),
					isNotNull(publicationSyncJob.deadLetteredAt),
					isNull(publicationSyncJob.supersededAt),
				),
			)
			.limit(1),
		database
			.select({
				id: publicationSyncJob.id,
				itemKey: publicationSyncJob.itemKey,
				provider: publicationSyncJob.provider,
				environment: publicationSyncJob.environment,
				leaseExpiresAt: publicationSyncJob.leaseExpiresAt,
			})
			.from(publicationSyncJob)
			.where(
				and(
					isNull(publicationSyncJob.processedAt),
					isNull(publicationSyncJob.deadLetteredAt),
					isNull(publicationSyncJob.supersededAt),
					isNotNull(publicationSyncJob.leaseOwner),
					gt(publicationSyncJob.leaseExpiresAt, now),
				),
			)
			.orderBy(asc(publicationSyncJob.id))
			.limit(1),
	]);
	const run = runs[0] ?? null;
	const parsedProgress = publicationWorkerProgressSchema.safeParse(run?.result);
	const progress = parsedProgress.success ? parsedProgress.data : null;
	const currentJob = currentJobs[0] ?? null;
	return {
		providers: {
			crossref: config.services.publication.crossref.enabled,
			zenodo: config.services.publication.zenodo.enabled,
		},
		queue: {
			hasFailed: failed.length > 0,
			hasPending: pending.length > 0,
			nextAttemptAt: pending[0]?.nextAttemptAt.toISOString() ?? null,
		},
		currentJob:
			currentJob?.leaseExpiresAt
				? {
						...currentJob,
						leaseExpiresAt: currentJob.leaseExpiresAt.toISOString(),
					}
				: null,
		worker:
			run && progress
				? {
						active:
							run.status === "running" &&
							Boolean(run.leaseExpiresAt && run.leaseExpiresAt > now),
						ready: publicationWorkerIsReady(run, now),
						runId: run.id,
						workerId: progress.workerId,
						instanceId: progress.instanceId,
						stage: progress.stage,
						currentProvider: progress.currentProvider,
						heartbeatAt: run.heartbeatAt?.toISOString() ?? null,
						startedAt: run.startedAt.toISOString(),
						stoppedAt: run.completedAt?.toISOString() ?? null,
						lastCompletedAt: progress.lastCompletedAt,
						lastError: progress.lastError ?? run.failure,
						claimedJobs: run.claimedJobs,
						succeededJobs: run.succeededJobs,
						failedJobs: run.failedJobs,
					}
				: null,
	};
}
