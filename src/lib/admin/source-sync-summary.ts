import type { AdminSourceSync } from "./types";

function iso(value: Date | null) {
	return value ? value.toISOString() : null;
}

/** Turns the sync state row, its active run, and the issue count into what the admin shows. */
export function sourceSyncSummary(input: {
	activeRunStartedAt: Date | null;
	issueCount: number;
	lastError: string | null;
	lastFailureAt: Date | null;
	lastResult: Record<string, unknown> | null;
	lastSuccessAt: Date | null;
	leaseExpiresAt: Date | null;
	now: Date;
	/** The connection's saved cursor; a partial import stores its offset in `pending`. */
	syncCursor: unknown;
}): AdminSourceSync {
	// A run whose worker lease expired has stopped without finishing. The
	// next claim records it as failed; show it that way already.
	const leaseLost =
		input.activeRunStartedAt !== null &&
		input.leaseExpiresAt !== null &&
		input.leaseExpiresAt <= input.now;
	const running = input.activeRunStartedAt !== null && !leaseLost;
	const lastError = leaseLost
		? "The import stopped without finishing. It restarts when a worker picks it up again."
		: input.lastError;
	const records = input.lastResult?.records;
	const offset = (
		input.syncCursor as { pending?: { offset?: unknown } } | null
	)?.pending?.offset;
	return {
		issueCount: input.issueCount,
		lastError,
		lastFailureAt: iso(leaseLost ? input.leaseExpiresAt : input.lastFailureAt),
		lastRecords: typeof records === "number" ? records : null,
		lastSuccessAt: iso(input.lastSuccessAt),
		processed: running && typeof offset === "number" ? offset : null,
		runningSince: running ? iso(input.activeRunStartedAt) : null,
		status: running
			? "running"
			: lastError
				? "failed"
				: input.lastSuccessAt
					? "succeeded"
					: "idle",
	};
}
