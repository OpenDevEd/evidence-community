import { describe, expect, it } from "vitest";

import { fileAccessModes, fileAccessOf, filesHiddenOn, licenceFromRights, licenceOpen, recordLicenceSchema } from "@/lib/licences";

describe("the licence a rights statement names", () => {
	it.each([
		["© 2023 The Authors. This is an open access article under the CC BY 4.0 license.", "cc-by-4.0"],
		["Licensed under CC BY-NC-SA 4.0", "cc-by-nc-sa-4.0"],
		["https://creativecommons.org/licenses/by-nc-nd/4.0/", "cc-by-nc-nd-4.0"],
		["CC0", "cc0-1.0"],
		["Creative Commons Attribution 4.0 International", "cc-by-4.0"],
		["https://creativecommons.org/licenses/by-nc-nd/3.0/igo/", "cc-by-nc-nd-3.0-igo"],
		["https://creativecommons.org/licenses/by/4.0/legalcode", "cc-by-4.0"],
		["Licensed under CC BY 3.0 US", "cc-by-3.0-us"],
		["CC BY 4.0 International", "cc-by-4.0"],
		["CC BY-SA 4.0 or later", "cc-by-sa-4.0"],
		["Mozilla Public License 2.0 (no copyleft exception)", "mpl-2.0-no-copyleft-exception"],
	])("reads %s as %s", (rights, id) => {
		expect(licenceFromRights(rights)).toBe(id);
	});

	// A licence without its version, or a statement that names none, is left for a person to pick, never guessed.
	it.each(["CC BY", "https://creativecommons.org/licenses/by/3.0/de/", "https://creativecommons.org/licenses/by/2.5/scotland/", "CC BY 3.0 DE", "© World Bank. All rights reserved.", ""])("finds none in %j", (rights) => {
		expect(licenceFromRights(rights)).toBeNull();
	});
});

describe("who may get a record's files", () => {
	const ccBy = { kind: "zenodo", id: "cc-by-4.0" } as const;
	const closed = { kind: "zenodo", id: "other-closed" } as const;

	it("follows the licence: an open one offers anyone, one that isn't offers readers here or editors only", () => {
		expect(licenceOpen(ccBy)).toBe(true);
		expect(licenceOpen(closed)).toBe(false);
		expect(licenceOpen({ kind: "custom", title: "Ours", url: "https://example.org", open: false })).toBe(false);
		expect(fileAccessModes(ccBy)).toEqual(["open", "private", "embargo"]);
		expect(fileAccessModes(closed)).toEqual(["readers", "private"]);
	});

	it("takes the licence's own when nothing was chosen, or a choice the licence doesn't allow", () => {
		expect(fileAccessOf(ccBy, null)).toEqual({ mode: "open" });
		expect(fileAccessOf(closed, null)).toEqual({ mode: "private" });
		expect(fileAccessOf(closed, { mode: "open" })).toEqual({ mode: "private" });
		expect(fileAccessOf(closed, { mode: "readers" })).toEqual({ mode: "readers" });
		// Deposited under it before files could be kept, a record's files stay public until an editor chooses otherwise.
		expect(fileAccessOf(closed, { mode: "open", asDeposited: true })).toEqual({ mode: "open", asDeposited: true });
	});

	it("counts a licence of a record's own saved before it said whether it is open as open", () => {
		const saved = recordLicenceSchema.parse({ kind: "custom", title: "Ours", url: "https://example.org" });
		expect(licenceOpen(saved)).toBe(true);
	});

	it("keeps files from readers while private, and under an embargo until its day", () => {
		expect(filesHiddenOn({ mode: "private" }, "2026-11-19")).toBe(true);
		expect(filesHiddenOn({ mode: "readers" }, "2026-11-19")).toBe(false);
		expect(filesHiddenOn({ mode: "embargo", until: "2027-06-01" }, "2027-05-31")).toBe(true);
		expect(filesHiddenOn({ mode: "embargo", until: "2027-06-01" }, "2027-06-01")).toBe(false);
	});
});
