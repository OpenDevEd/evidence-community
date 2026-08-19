import { describe, expect, it } from "vitest";

import {
	resolveWritebackDialogOptions,
	writebackDialogSummary,
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

	it("preselects the stored choice, marks the origin, and says what each source has today", () => {
		expect(
			resolveWritebackDialogOptions({
				available: [
					target({ sourceKey: "a" }),
					target({
						isOrigin: true,
						itemEnabled: true,
						linkExists: true,
						reason: "ok",
						sourceKey: "b",
					}),
					target({ linkExists: true, reason: "item-locked", sourceKey: "c" }),
				],
				originSourceKey: "b",
				selected: ["b"],
			}),
		).toEqual([
			{
				checked: false,
				disabled: false,
				helper: null,
				isOrigin: false,
				provider: "zotero",
				sourceKey: "a",
				sourceLabel: "Zotero · a",
				status: { text: "Not sent yet", tone: "off" },
			},
			{
				checked: true,
				disabled: false,
				helper: null,
				isOrigin: true,
				provider: "zotero",
				sourceKey: "b",
				sourceLabel: "Zotero · b",
				status: { text: "Receives updates", tone: "ok" },
			},
			{
				checked: false,
				disabled: false,
				helper: null,
				isOrigin: false,
				provider: "zotero",
				sourceKey: "c",
				sourceLabel: "Zotero · c",
				status: { text: "Has a copy, updates paused", tone: "off" },
			},
		]);
	});

	it("keeps sources that are turned off, paused or removed switched off and disabled with the reason", () => {
		const options = resolveWritebackDialogOptions({
			available: [
				target({
					effective: false,
					itemEnabled: true,
					linkExists: true,
					reason: "source-disabled",
					sourceEnabled: false,
					sourceKey: "off",
				}),
				target({
					effective: false,
					reason: "source-paused",
					sourceKey: "paused",
					sourceStatus: "paused",
				}),
				target({
					effective: false,
					reason: "source-removed",
					sourceKey: "gone",
					sourceStatus: "removed",
				}),
			],
			originSourceKey: null,
			selected: ["off"],
		});
		expect(
			options?.map((option) => [
				option.sourceKey,
				option.checked,
				option.disabled,
				option.status,
			]),
		).toEqual([
			["off", false, true, { text: "Turned off in library settings", tone: "warn" }],
			["paused", false, true, { text: "Paused in library settings", tone: "warn" }],
			["gone", false, true, { text: "Removed from library settings", tone: "warn" }],
		]);
	});

	it("describes copies when unpublishing", () => {
		const options = resolveWritebackDialogOptions(
			{
				available: [
					target({ linkExists: true, itemEnabled: true, reason: "ok", sourceKey: "a" }),
					target({ sourceKey: "b" }),
				],
				originSourceKey: null,
				selected: ["a"],
			},
			"unpublish",
		);
		expect(options?.map((option) => option.status.text)).toEqual([
			"Has a copy of this record",
			"No copy of this record",
		]);
	});
});

describe("dialog wording", () => {
	it("names each mode in plain words and says this library always takes part", () => {
		expect(writebackDialogText("publish").title).toBe("Publish this record");
		expect(writebackDialogText("publish").intro).toMatch(/This library always gets it/);
		expect(writebackDialogText("unpublish").title).toBe("Unpublish this record");
		expect(writebackDialogText("unpublish").intro).toMatch(/leaves this library either way/);
		expect(writebackDialogText("manage").confirm).toBe("Save");
	});

	it("sums up the choice in the footer", () => {
		expect(writebackDialogSummary("publish", 0)).toBe("Here only");
		expect(writebackDialogSummary("publish", 1)).toBe("Here + 1 source");
		expect(writebackDialogSummary("manage", 2)).toBe("Here + 2 sources");
		expect(writebackDialogSummary("unpublish", 0)).toBe("Removes from here only");
		expect(writebackDialogSummary("unpublish", 2)).toBe("Removes from here + 2 sources");
	});
});
