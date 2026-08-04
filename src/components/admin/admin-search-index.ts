import type {
	AdminSearchIndexOverview,
	AdminSearchIndexReceipt,
	AdminSearchIndexReceiptStatus,
} from "@/lib/admin/search-index-contract";
import { adminSearchIndexReceiptIdentity } from "@/lib/admin/search-index-contract";
import { chunkValues } from "@/lib/chunk-values";

export const ADMIN_SEARCH_INDEX_ACTIVE_POLL_MS = 1_000;
export const ADMIN_SEARCH_INDEX_IDLE_POLL_MS = 10_000;

export function adminSearchIndexEntityIdentity(
	receipt: AdminSearchIndexReceipt,
) {
	return `${receipt.entityType}:${receipt.entityKey}`;
}

export function mergeAdminSearchIndexReceipts(
	current: readonly AdminSearchIndexReceiptStatus[],
	incoming: readonly AdminSearchIndexReceipt[],
) {
	const latest = new Map(
		current.map((receipt) => [adminSearchIndexEntityIdentity(receipt), receipt]),
	);
	for (const receipt of incoming) {
		const identity = adminSearchIndexEntityIdentity(receipt);
		const existing = latest.get(identity);
		if (existing && existing.revision > receipt.revision) continue;
		if (existing && existing.revision === receipt.revision) continue;
		latest.set(identity, {
			...receipt,
			attempts: null,
			createdAt: null,
			error: null,
			nextAttemptAt: null,
			processedAt: null,
			state: "queued",
		});
	}
	return [...latest.values()];
}

export function mergeAdminSearchIndexStatuses(
	current: readonly AdminSearchIndexReceiptStatus[],
	incoming: readonly AdminSearchIndexReceiptStatus[],
) {
	const statuses = new Map(
		current.map((receipt) => [adminSearchIndexReceiptIdentity(receipt), receipt]),
	);
	for (const receipt of incoming) {
		statuses.set(adminSearchIndexReceiptIdentity(receipt), receipt);
	}
	return current.map(
		(receipt) =>
			statuses.get(adminSearchIndexReceiptIdentity(receipt)) ?? receipt,
	);
}

export type AdminSearchIndexView = {
	canRetry: boolean;
	description: string;
	kind:
		| "checking"
		| "failed"
		| "indexed"
		| "indexing"
		| "offline"
		| "queued"
		| "ready"
		| "retrying"
		| "unavailable";
	label: string;
	progress: number | null;
};

export function deriveAdminSearchIndexView(input: {
	completed: boolean;
	error: string | null;
	loading: boolean;
	overview: AdminSearchIndexOverview | null;
	receiptUnavailable: boolean;
	receipts: readonly AdminSearchIndexReceiptStatus[];
	retrying: boolean;
}): AdminSearchIndexView {
	const {
		completed,
		error,
		loading,
		overview,
		receiptUnavailable,
		receipts,
		retrying,
	} = input;
	const worker = overview?.worker ?? null;
	const failed = receipts.some(({ state }) => state === "failed");
	const exactProcessing = receipts.some(({ state }) => state === "processing");
	const exactQueued = receipts.some(({ state }) => state === "queued");
	const exactRetrying = receipts.some(({ state }) => state === "retrying");
	const exactPending = exactProcessing || exactQueued || exactRetrying;
	const pending = exactPending || Boolean(overview?.queue.hasPending);

	if (retrying) {
		return {
			canRetry: false,
			description: "Retrying failed search updates.",
			kind: "retrying",
			label: "Retrying search",
			progress: null,
		};
	}
	if (failed || overview?.queue.hasFailed) {
		return {
			canRetry: true,
			description:
				"Published changes are saved, but at least one search update failed.",
			kind: "failed",
			label: "Indexing failed",
			progress: null,
		};
	}
	if (error || receiptUnavailable) {
		return {
			canRetry: false,
			description: receiptUnavailable
				? "A saved search update could not be found. Check the worker before publishing again."
				: "Search indexing status could not be loaded. Try again.",
			kind: "unavailable",
			label: "Status unavailable",
			progress: null,
		};
	}
	if (worker?.active && worker.stage === "retrying") {
		return {
			canRetry: false,
			description:
				"The search worker hit a temporary error and will retry automatically.",
			kind: "retrying",
			label: "Retry scheduled",
			progress: null,
		};
	}
	if (pending) {
		if (!worker?.active) {
			return {
				canRetry: false,
				description:
					"Published changes are saved and waiting for the search worker.",
				kind: "offline",
				label: "Search paused",
				progress: null,
			};
		}
		if (worker.stage === "retrying" || exactRetrying) {
			return {
				canRetry: false,
				description:
					"The search worker hit a temporary error and will retry automatically.",
				kind: "retrying",
				label: "Retry scheduled",
				progress: null,
			};
		}
		if (
			worker.stage === "starting" ||
			worker.stage === "idle" ||
			worker.stage === "waiting" ||
			(exactQueued && !exactProcessing)
		) {
			return {
				canRetry: false,
				description:
					worker.stage === "starting"
						? "Published changes are saved while the search worker starts."
						: "Published changes are saved and queued for search.",
				kind: "queued",
				label:
					worker.stage === "starting" ? "Worker starting" : "Search queued",
				progress: null,
			};
		}
		if (worker.stage === "stopping" || worker.stage === "stopped") {
			return {
				canRetry: false,
				description:
					"Published changes are saved while the search worker is stopped.",
				kind: "offline",
				label: "Search paused",
				progress: null,
			};
		}
		const progress = worker.stage === "indexing" ? worker.batchProgress : null;
		return {
			canRetry: false,
			description:
				worker.stage === "projecting"
					? "Preparing queued updates for the search index."
					: "The search worker is applying queued updates.",
			kind: "indexing",
			label:
				progress === null
					? worker.stage === "projecting"
						? "Preparing search"
						: "Indexing"
					: `Indexing ${Math.round(progress)}%`,
			progress,
		};
	}
	if (completed) {
		return {
			canRetry: false,
			description: "The latest published changes are available in search.",
			kind: "indexed",
			label: "Search updated",
			progress: null,
		};
	}
	if (!overview && loading) {
		return {
			canRetry: false,
			description: "Checking the search index worker.",
			kind: "checking",
			label: "Checking search",
			progress: null,
		};
	}
	if (!worker?.active) {
		return {
			canRetry: false,
			description: "The search index worker is not running.",
			kind: "offline",
			label: "Search offline",
			progress: null,
		};
	}
	return {
		canRetry: false,
		description: "Published content and search are up to date.",
		kind: "ready",
		label: "Search ready",
		progress: null,
	};
}

export function adminSearchIndexShouldPollFast(
	overview: AdminSearchIndexOverview | null,
	receipts: readonly AdminSearchIndexReceiptStatus[],
) {
	return (
		Boolean(overview?.queue.hasPending) ||
		(overview?.worker?.active === true &&
			overview.worker.stage === "retrying") ||
		receipts.some(({ state }) =>
			["processing", "queued", "retrying"].includes(state),
		)
	);
}
