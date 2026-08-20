import type { AdminSourceWritebackStatus } from "@/lib/admin/source-writeback-contract";

type State = AdminSourceWritebackStatus["state"];

/** Worst state first: what the admin must look at before anything else. */
const PRIORITY: State[] = [
	"conflict",
	"failed",
	"removed",
	"retrying",
	"sending",
	"queued",
	"paused",
	"disabled",
	"unsupported",
	"locked",
	"idle",
	"synced",
];

/**
 * Folds the per-source states of one record into the single state shown on
 * the record's "Sources" chip. A source whose state is not known yet counts
 * as idle, so the chip never claims more than it knows.
 */
export function summarizeWritebackStates(
	states: readonly (State | null | undefined)[],
): State {
	if (states.length === 0) return "idle";
	for (const candidate of PRIORITY) {
		if (states.some((state) => (state ?? "idle") === candidate)) {
			return candidate;
		}
	}
	return "idle";
}

export function writebackSummaryLabel(state: State, sourceCount: number) {
	const sources = sourceCount === 1 ? "1 source" : `${sourceCount} sources`;
	switch (state) {
		case "synced":
			return `Synced to ${sources}`;
		case "conflict":
			return "Needs a decision";
		case "failed":
			return "Sync failed";
		case "queued":
		case "sending":
		case "retrying":
			return "Syncing";
		default:
			return sources;
	}
}
