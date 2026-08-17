import { z } from "zod";

export const PUBLICATION_WORKER_STAGES = [
	"starting",
	"reconciling",
	"crossref",
	"zenodo",
	"idle",
	"retrying",
	"stopping",
	"stopped",
] as const;

export const publicationWorkerStageSchema = z.enum(PUBLICATION_WORKER_STAGES);

export const publicationWorkerProgressSchema = z
	.object({
		workerId: z.string().min(1).max(255),
		instanceId: z.string().min(1).max(56),
		stage: publicationWorkerStageSchema,
		currentProvider: z.enum(["crossref", "zenodo"]).nullable(),
		lastCompletedAt: z.iso.datetime().nullable(),
		lastError: z.string().nullable(),
	})
	.strict();

export type PublicationWorkerStage = z.infer<
	typeof publicationWorkerStageSchema
>;
export type PublicationWorkerProgress = z.infer<
	typeof publicationWorkerProgressSchema
>;
