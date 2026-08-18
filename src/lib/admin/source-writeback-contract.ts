import { z } from "zod";

export const adminSourceWritebackStateSchema = z.enum([
	"conflict",
	"disabled",
	"failed",
	"idle",
	"locked",
	"paused",
	"queued",
	"removed",
	"retrying",
	"sending",
	"synced",
	"unsupported",
]);

export const adminSourceWritebackStatusSchema = z.object({
	attempts: z.number().int().nonnegative(),
	canonicalRevision: z.number().int().positive().nullable(),
	error: z.string().nullable(),
	jobId: z.number().int().positive().nullable(),
	nextAttemptAt: z.string().nullable(),
	processedAt: z.string().nullable(),
	sourceKey: z.string().nullable(),
	state: adminSourceWritebackStateSchema,
});

export type AdminSourceWritebackStatus = z.infer<
	typeof adminSourceWritebackStatusSchema
>;

export const ACTIVE_ADMIN_SOURCE_WRITEBACK_STATES = [
	"queued",
	"retrying",
	"sending",
] as const satisfies readonly AdminSourceWritebackStatus["state"][];

export function adminSourceWritebackShouldPollFast(
	status: AdminSourceWritebackStatus | null,
) {
	return Boolean(
		status &&
			ACTIVE_ADMIN_SOURCE_WRITEBACK_STATES.some(
				(state) => state === status.state,
			),
	);
}
