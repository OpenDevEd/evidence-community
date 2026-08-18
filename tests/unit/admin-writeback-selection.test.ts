import { describe, expect, it } from "vitest";

import {
	resolveWritebackDialogOptions,
	writebackDialogText,
} from "@/components/admin/writeback-selection";
import type { AdminItemWritebackTarget } from "@/lib/admin/types";

function target(
	overrides: Partial<AdminItemWritebackTarget> & { sourceKey: string },
): AdminItemWritebackTarget {
	return {
		effective: true,
		isOrigin: false,
		itemEnabled: false,
		linkExists: false,
		provider: "zotero",
		reason: "not-linked",
		sourceEnabled: true,
		sourceLabel: `Zotero · ${overrides.sourceKey}`,
		sourceStatus: "active",
		supported: true,
		...overrides,
	};
}

describe("resolveWritebackDialogOptions", () => {
	it("returns null when there is nothing to ask", () => {
		expect(
			resolveWritebackDialogOptions({
				available: [],
				originSourceKey: null,
				selected: [],
			}),
		).toBeNull();
	});

	it("preselects the stored choice and marks the origin", () => {
		expect(
			resolveWritebackDialogOptions({
				available: [
					target({ sourceKey: "a" }),
					target({ isOrigin: true, itemEnabled: true, linkExists: true, reason: "ok", sourceKey: "b" }),
				],
				originSourceKey: "b",
				selected: ["b"],
			}),
		).toEqual([
			{ checked: false, disabled: false, helper: null, isOrigin: false, sourceKey: "a", sourceLabel: "Zotero · a" },
			{ checked: true, disabled: false, helper: null, isOrigin: true, sourceKey: "b", sourceLabel: "Zotero · b" },
		]);
	});

	it("keeps sources that are turned off, paused or removed unchecked and disabled with a reason", () => {
		const options = resolveWritebackDialogOptions({
			available: [
				target({ effective: false, itemEnabled: true, linkExists: true, reason: "source-disabled", sourceEnabled: false, sourceKey: "off" }),
				target({ effective: false, reason: "source-paused", sourceKey: "paused", sourceStatus: "paused" }),
				target({ effective: false, reason: "source-removed", sourceKey: "gone", sourceStatus: "removed" }),
			],
			originSourceKey: null,
			selected: ["off"],
		});
		expect(options?.map((option) => [option.sourceKey, option.checked, option.disabled, option.helper])).toEqual([
			["off", false, true, "Turned off in library settings"],
			["paused", false, true, "This source is paused"],
			["gone", false, true, "This source has been removed"],
		]);
	});
});

describe("writebackDialogText", () => {
	it("names each mode in plain words", () => {
		expect(writebackDialogText("publish")).toEqual({
			confirm: "Publish",
			group: "Also update",
			title: "Publish this record",
		});
		expect(writebackDialogText("unpublish")).toEqual({
			confirm: "Unpublish",
			group: "Also remove from",
			title: "Unpublish this record",
		});
		expect(writebackDialogText("manage")).toEqual({
			confirm: "Save",
			group: "Send future updates to",
			title: "Sources for this record",
		});
	});
});
