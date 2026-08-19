import type { AdminItemWriteback } from "@/lib/admin/types";

export type WritebackDialogMode = "manage" | "publish" | "unpublish";

export type WritebackDialogOption = {
	checked: boolean;
	disabled: boolean;
	helper: string | null;
	isOrigin: boolean;
	provider: string;
	sourceKey: string;
	sourceLabel: string;
};

const blockedHelper: Record<string, string> = {
	"source-disabled": "Turned off in library settings",
	"source-paused": "This source is paused",
	"source-removed": "This source has been removed",
	"unsupported-provider": "This source type does not support writeback",
};

/**
 * Turns a record's writeback targets into dialog checkboxes. Returns null
 * when the library has no source to offer, so the caller can skip the dialog.
 * A source that cannot receive updates is shown unchecked and disabled with
 * the reason, even when the record still stores it as selected.
 */
export function resolveWritebackDialogOptions(
	writeback: AdminItemWriteback,
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
		};
	});
}

export function writebackDialogText(mode: WritebackDialogMode) {
	switch (mode) {
		case "publish":
			return {
				confirm: "Publish",
				group: "Also update",
				title: "Publish this record",
			};
		case "unpublish":
			return {
				confirm: "Unpublish",
				group: "Also remove from",
				title: "Unpublish this record",
			};
		case "manage":
			return {
				confirm: "Save",
				group: "Send future updates to",
				title: "Sources for this record",
			};
	}
}
