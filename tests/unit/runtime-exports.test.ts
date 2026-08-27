import { describe, expect, it } from "vitest";

import {
	getDownloadableRecordCount,
	getEnabledCitationFormats,
	getLibraryExportContentType,
	getLibraryExportPath,
	getRecordCitationLinks,
	LIBRARY_EXPORT_RECORD_CAP,
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

	// The whole-library file stops at the cap, so the download button must not
	// offer a bigger number than the file can hold.
	it.each([
		[0, 0],
		[42, 42],
		[LIBRARY_EXPORT_RECORD_CAP, LIBRARY_EXPORT_RECORD_CAP],
		[LIBRARY_EXPORT_RECORD_CAP + 1, LIBRARY_EXPORT_RECORD_CAP],
		[500_000, LIBRARY_EXPORT_RECORD_CAP],
	])("offers %i records as %i", (total, offered) => {
		expect(getDownloadableRecordCount(total)).toBe(offered);
	});
});

describe("record page citation links", () => {
	it("lists both citation files when both switches are on", () => {
		expect(
			getRecordCitationLinks(
				{ ris: true, bibtex: true, atom: false },
				true,
				"ABCD1234",
			),
		).toEqual([
			{
				contentType: "application/x-research-info-systems",
				path: "/lib/ABCD1234/export/ris",
			},
			{
				contentType: "application/x-bibtex",
				path: "/lib/ABCD1234/export/bibtex",
			},
		]);
	});

	it("lists only the format whose switch is on", () => {
		expect(
			getRecordCitationLinks(
				{ ris: false, bibtex: true, atom: false },
				true,
				"ABCD1234",
			),
		).toEqual([
			{
				contentType: "application/x-bibtex",
				path: "/lib/ABCD1234/export/bibtex",
			},
		]);
	});

	it("lists nothing when downloads are switched off", () => {
		expect(
			getRecordCitationLinks(
				{ ris: true, bibtex: true, atom: false },
				false,
				"ABCD1234",
			),
		).toEqual([]);
	});
});
