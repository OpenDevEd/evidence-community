import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { shownChecked } from "@/components/features/collections/CollectionPicker";

describe("a collection picker row the reader pressed", () => {
	const added = { from: false, to: true };

	it("shows the new state while the change saves", () => {
		expect(shownChecked(false, { ...added, saving: true })).toBe(true);
	});

	// One save's reload is dropped when another starts, so a saved row can still read the old list.
	it("keeps the new state after saving while the list still shows the old one", () => {
		expect(shownChecked(false, { ...added, saving: false })).toBe(true);
	});

	it("follows the list once it shows the change", () => {
		expect(shownChecked(true, { ...added, saving: false })).toBe(true);
		expect(shownChecked(true, undefined)).toBe(true);
		expect(shownChecked(false, undefined)).toBe(false);
	});
});
