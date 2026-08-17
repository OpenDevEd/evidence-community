import { z } from "zod";

import { publicationWorkerStageSchema } from "@/lib/publication/worker-contract";

export const adminPublicationWorkerOverviewSchema = z
	.object({
		providers: z
			.object({ crossref: z.boolean(), zenodo: z.boolean() })
			.strict(),
		queue: z
			.object({
				hasFailed: z.boolean(),
				hasPending: z.boolean(),
				nextAttemptAt: z.string().nullable(),
			})
			.strict(),
		currentJob: z
			.object({
				id: z.number().int().positive(),
				itemKey: z.string().min(1),
				provider: z.enum(["crossref", "zenodo"]),
				environment: z.enum(["test", "sandbox"]),
				leaseExpiresAt: z.string(),
			})
			.strict()
			.nullable(),
		worker: z
			.object({
				active: z.boolean(),
				ready: z.boolean(),
				runId: z.string().min(1),
				workerId: z.string().min(1),
				instanceId: z.string().min(1),
				stage: publicationWorkerStageSchema,
				currentProvider: z.enum(["crossref", "zenodo"]).nullable(),
				heartbeatAt: z.string().nullable(),
				startedAt: z.string(),
				stoppedAt: z.string().nullable(),
				lastCompletedAt: z.string().nullable(),
				lastError: z.string().nullable(),
				claimedJobs: z.number().int().nonnegative(),
				succeededJobs: z.number().int().nonnegative(),
				failedJobs: z.number().int().nonnegative(),
			})
			.strict()
			.nullable(),
	})
	.strict();

export type AdminPublicationWorkerOverview = z.infer<
	typeof adminPublicationWorkerOverviewSchema
>;
