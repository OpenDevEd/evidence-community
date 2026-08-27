import { describe, expect, it } from "vitest";

import {
	getEnabledCitationFormats,
	getLibraryExportContentType,
	getLibraryExportPath,
} from "@/config/library-config/exports";

describe("runtime exports", () => {
	it("lists only the citation formats whose switch is on", () => {
		expect(
			getEnabledCitationFormats({
				ris: true,
				bibtex: false,
				atom: true,
			}),
		).toEqual(["ris"]);
	});

	it("lists nothing when both citation switches are off", () => {
		expect(
			getEnabledCitationFormats({
				ris: false,
				bibtex: false,
				atom: true,
			}),
		).toEqual([]);
	});

	it.each([
		["ris", "/lib/export/ris"],
		["bibtex", "/lib/export/bibtex"],
		["atom", "/lib/atom.xml"],
	] as const)("maps %s to its same-origin route", (format, pathname) => {
		expect(getLibraryExportPath(format)).toBe(pathname);
	});

	it.each([
		["ris", "application/x-research-info-systems; charset=utf-8"],
		["bibtex", "application/x-bibtex; charset=utf-8"],
		["atom", "application/atom+xml; charset=utf-8"],
	] as const)("serves %s with its own content type", (format, type) => {
		expect(getLibraryExportContentType(format)).toBe(type);
	});
});
