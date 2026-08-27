import { describe, expect, it } from "vitest";

import {
	getLibraryExportPath,
	getWholeLibraryFileFormats,
	isApprovedLibraryExportContentType,
} from "@/config/library-config/exports";

describe("runtime exports", () => {
	it("lists only the whole-library files that have an address", () => {
		expect(
			getWholeLibraryFileFormats({
				ris: true,
				bibtex: false,
				atom: true,
			}),
		).toEqual(["ris"]);
	});

	it.each([
		["ris", "/lib/export/ris"],
		["bibtex", "/lib/export/bibtex"],
		["atom", "/lib/atom.xml"],
	] as const)("maps %s to its same-origin route", (format, pathname) => {
		expect(getLibraryExportPath(format)).toBe(pathname);
	});

	it.each([
		["ris", "application/x-research-info-systems", true],
		["ris", "text/plain; charset=utf-8", true],
		["bibtex", "application/x-bibtex", true],
		["atom", "application/atom+xml; charset=utf-8", true],
		["atom", "text/html", false],
		["bibtex", null, false],
	] as const)(
		"validates the %s upstream content type",
		(format, contentType, approved) => {
			expect(
				isApprovedLibraryExportContentType(format, contentType),
			).toBe(approved);
		},
	);
});
