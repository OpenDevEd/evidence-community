import type { AdminItemWriteback } from "@/lib/admin/types";

export type WritebackDialogMode = "manage" | "restore" | "unpublish";

export type WritebackDialogStatusTone = "off" | "ok" | "warn";

export type WritebackDialogOption = {
	checked: boolean;
	disabled: boolean;
	/** Why the source cannot be chosen right now, or null when it can. */
	helper: string | null;
	isOrigin: boolean;
	provider: string;
	sourceKey: string;
	sourceLabel: string;
	/** One short line under the name: what the source has and does today. */
	status: { text: string; tone: WritebackDialogStatusTone };
};

const blockedHelper: Record<string, string> = {
	"source-disabled": "Turned off in community settings",
	"source-paused": "Paused in community settings",
	"source-removed": "Removed from community settings",
	"unsupported-provider": "Keeps its own copy: it can't be changed from here",
};

function statusFor(
	target: AdminItemWriteback["available"][number],
	mode: WritebackDialogMode,
	helper: string | null,
): WritebackDialogOption["status"] {
	if (helper) return { text: helper, tone: "warn" };
	if (mode === "unpublish") {
		return target.linkExists
			? { text: "Has a copy of this record", tone: "ok" }
			: { text: "No copy of this record", tone: "off" };
	}
	if (target.linkExists && target.itemEnabled) {
		return { text: "Receives updates", tone: "ok" };
	}
	if (target.linkExists) {
		return { text: "Has a copy, updates paused", tone: "off" };
	}
	return { text: "Not sent yet", tone: "off" };
}

/**
 * Turns a record's writeback targets into dialog rows. Returns null when
 * the library has no source to offer, so the caller can skip the dialog.
 * A source that cannot receive updates is shown switched off and disabled
 * with the reason, even when the record still stores it as selected.
 */
export function resolveWritebackDialogOptions(
	writeback: AdminItemWriteback,
	mode: WritebackDialogMode = "restore",
): WritebackDialogOption[] | null {
	if (writeback.available.length === 0) return null;
	const selected = new Set(writeback.selected);
	return writeback.available.map((target) => {
		const helper = blockedHelper[target.reason] ?? null;
		const disabled = helper !== null;
		return {
			checked: !disabled && selected.has(target.sourceKey),
			disabled,
			helper,
			isOrigin: target.isOrigin,
			provider: target.provider,
			sourceKey: target.sourceKey,
			sourceLabel: target.sourceLabel,
			status: statusFor(target, mode, helper),
		};
	});
}

export function writebackDialogText(mode: WritebackDialogMode) {
	switch (mode) {
		case "restore":
			return {
				confirm: "Submit for review",
				here: "Public after approval",
				intro:
					"An Editor must approve the restored record before it goes public. Choose which sources should receive it when published.",
				title: "Restore this record",
			};
		case "unpublish":
			return {
				confirm: "Unpublish",
				here: "Removed from the public page and search",
				intro:
					"It comes off this community's site either way. Where a source below has its own copy, switch it on to delete that copy too.",
				title: "Unpublish this record",
			};
		case "manage":
			return {
				confirm: "Save",
				here: "Public page and search",
				intro:
					"This community always keeps it. Switch on the sources that should receive future updates.",
				title: "Sources for this record",
			};
	}
}

/** The one-line footer: "Here + 2 sources", "Here + 1 source", "Here only". */
export function writebackDialogSummary(
	mode: WritebackDialogMode,
	selectedCount: number,
) {
	const sources =
		selectedCount === 1 ? "1 source" : `${selectedCount} sources`;
	if (mode === "unpublish") {
		return selectedCount === 0
			? "Removes from here only"
			: `Removes from here + ${sources}`;
	}
	return selectedCount === 0 ? "Here only" : `Here + ${sources}`;
}
