export type AdminPublicationProviderState =
	| "inactive"
	| "blocked"
	| "waiting"
	| "queued"
	| "working"
	| "verifying"
	| "retrying"
	| "repair_pending"
	| "synced"
	| "failed";

export type AdminPublicationPlanState =
	| "unavailable"
	| "skipped"
	| "needs_attention"
	| "waiting_for_file"
	| "noop"
	| "write_required";

export type AdminPublicationJobState = {
	attempts: number;
	deadLetteredAt: Date | null;
	leaseExpiresAt: Date | null;
	leaseOwner: string | null;
	nextAttemptAt: Date;
	processedAt: Date | null;
	supersededAt: Date | null;
};

export type AdminPublicationStateInput = {
	provider: "crossref" | "zenodo";
	configured: boolean;
	targetActive: boolean;
	blockers: readonly string[];
	plan: { status: AdminPublicationPlanState };
	job: AdminPublicationJobState | null;
	pending: boolean;
	journal: boolean;
	failure: boolean;
	waitingOn: "crossref" | "file" | null;
};

export function resolveAdminPublicationProviderState(
	input: AdminPublicationStateInput,
	now = new Date(),
): AdminPublicationProviderState {
	if (
		!input.configured ||
		input.blockers.length > 0 ||
		input.plan.status === "needs_attention"
	) {
		return "blocked";
	}
	if (!input.targetActive) return "inactive";
	if (
		input.waitingOn ||
		input.plan.status === "waiting_for_file"
	) {
		return "waiting";
	}

	const currentJob = input.job?.supersededAt ? null : input.job;
	if (
		currentJob?.leaseOwner &&
		currentJob.leaseExpiresAt &&
		currentJob.leaseExpiresAt.getTime() > now.getTime()
	) {
		return "working";
	}
	if (input.pending || input.journal) return "verifying";
	if (currentJob?.deadLetteredAt) return "failed";
	if (currentJob && !currentJob.processedAt) {
		return currentJob.attempts > 0 ? "retrying" : "queued";
	}
	if (input.failure) return "failed";
	if (input.plan.status === "noop") return "synced";
	return "repair_pending";
}
