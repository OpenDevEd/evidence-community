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
	| "failed"
	/** The record already has a DOI from another source; nothing to do here. */
	| "external";

export type AdminPublicationProviderStatus = {
	label: string;
	description: string;
	shouldPoll: boolean;
};

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
	/** A DOI that came with the record (imported or typed), not minted here. */
	externalDoi: string | null;
};

export function describeAdminPublicationProviderState(input: {
	provider: "crossref" | "zenodo";
	state: AdminPublicationProviderState;
	waitingOn: "crossref" | "file" | null;
	firstBlocker: string | null;
	externalDoi?: string | null;
}): AdminPublicationProviderStatus {
	const providerName = input.provider === "crossref" ? "Crossref" : "Zenodo";

	if (input.state === "external") {
		const doi = input.externalDoi ?? "from another source";
		return {
			label: "Has a DOI",
			description:
				input.provider === "crossref"
					? `This record already has the DOI ${doi} from another source. Crossref registration is not needed.`
					: `This record already has the DOI ${doi} from another source. Zenodo publishing is not used for it.`,
			shouldPoll: false,
		};
	}

	if (input.state === "blocked") {
		return {
			label: "Fix item details",
			description:
				input.firstBlocker ?? `${providerName} publishing is unavailable.`,
			shouldPoll: false,
		};
	}
	if (input.state === "inactive") {
		return input.provider === "crossref"
			? {
					label: "Not activated",
					description: "Reserve and register a Crossref DOI for this record.",
					shouldPoll: false,
				}
			: {
					label: "Not activated",
					description: "Publish this record and its files to Zenodo.",
					shouldPoll: false,
				};
	}
	if (input.state === "waiting") {
		return input.waitingOn === "crossref"
			? {
					label: "Waiting for Crossref",
					description:
						"Zenodo will publish after Crossref verifies the reserved DOI.",
					shouldPoll: true,
				}
			: {
					label: "Waiting for a PDF",
					description: "Publish a PDF attachment to continue with Zenodo.",
					shouldPoll: false,
				};
	}
	if (input.state === "queued") {
		return {
			label: "Queued",
			description: `${providerName} publishing will start when the worker is ready.`,
			shouldPoll: true,
		};
	}
	if (input.state === "working") {
		return {
			label: "Publishing",
			description: `${providerName} is publishing this record now.`,
			shouldPoll: true,
		};
	}
	if (input.state === "verifying") {
		return input.provider === "crossref"
			? {
					label: "Checking Crossref",
					description: "Crossref received the record and is checking it.",
					shouldPoll: true,
				}
			: {
					label: "Finishing publication",
					description: "Zenodo received the record and is finishing publication.",
					shouldPoll: true,
				};
	}
	if (input.state === "retrying") {
		return {
			label: "Retrying automatically",
			description: `${providerName} publishing will try again automatically.`,
			shouldPoll: true,
		};
	}
	if (input.state === "repair_pending") {
		return {
			label: "Waiting for repair",
			description: `The nightly repair check will queue the missing ${providerName} update.`,
			shouldPoll: false,
		};
	}
	if (input.state === "synced") {
		return {
			label: "Synced",
			description: `${providerName} matches the current published record.`,
			shouldPoll: false,
		};
	}
	return {
		label: "Needs attention",
		description: `${providerName} publishing failed. Review the error and try again.`,
		shouldPoll: false,
	};
}

export function resolveAdminPublicationProviderState(
	input: AdminPublicationStateInput,
	now = new Date(),
): AdminPublicationProviderState {
	// A DOI the record brought with it is a fact about the record, not a
	// problem to fix. Nothing was activated here, so there is nothing to show
	// as blocked.
	if (!input.targetActive && input.externalDoi) return "external";
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
