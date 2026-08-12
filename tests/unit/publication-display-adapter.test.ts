import { describe, expect, it } from "vitest";

import { buildPublicationDisplay } from "@/lib/publication/publication-display-adapter";

describe("buildPublicationDisplay", () => {
	it("keeps an imported DOI as an external bibliographic link", () => {
		const display = buildPublicationDisplay({
			DOI: "10.1234/imported",
		});

		expect(display.bibliographicDoi.status).toBe("resolved");
		expect(display.links.links).toEqual([
			{
				provider: "doi",
				kind: "doi",
				label: "DOI",
				value: "10.1234/imported",
				url: "https://doi.org/10.1234/imported",
			},
		]);
	});

	it("uses normalized managed identifiers and provider record IDs", () => {
		const display = buildPublicationDisplay({
			DOI: "10.1234/managed",
			publicationIdentifiers: {
				crossref: {
					doi: "10.1234/managed",
					lifecycle: "reserved",
				},
				zenodo: {
					versionDoi: "10.5281/zenodo.123",
					conceptDoi: "10.5281/zenodo.100",
					recordId: "123",
					conceptRecordId: "100",
					baseUrl: "https://sandbox.zenodo.org",
				},
			},
		});

		expect(display.links.links.map((link) => link.value)).toEqual([
			"10.1234/managed",
			"10.5281/zenodo.123",
			"10.5281/zenodo.100",
			"123",
			"100",
		]);
		expect(display.links.zenodoRecord?.url).toBe(
			"https://sandbox.zenodo.org/records/123",
		);
	});

	it("preserves imported Zenodo links without treating them as managed", () => {
		const display = buildPublicationDisplay({
			extra: [
				"ZenodoVersionDoi: 10.5281/zenodo.123",
				"ZenodoConceptDoi: 10.5281/zenodo.100",
				"Archive: https://sandbox.zenodo.org/records/123",
			].join("\n"),
			attachments: [
				{
					url: "https://sandbox.zenodo.org/records/123",
					tags: ["_r:zenodorecord"],
				},
			],
		});

		expect(display.links.zenodoVersionDoi?.value).toBe(
			"10.5281/zenodo.123",
		);
		expect(display.links.zenodoConceptDoi?.value).toBe(
			"10.5281/zenodo.100",
		);
		expect(display.links.zenodoRecord?.url).toBe(
			"https://sandbox.zenodo.org/records/123",
		);
		expect(display.managed).toBe(false);
	});

	it("restores Zenodo record links from Extra without an attachment", () => {
		const display = buildPublicationDisplay({
			extra: [
				"Archive: https://sandbox.zenodo.org/records/123",
				"ZenodoArchiveConcept: 100",
			].join("\n"),
		});

		expect(display.links.zenodoRecord?.url).toBe(
			"https://sandbox.zenodo.org/records/123",
		);
		expect(display.links.zenodoConceptRecord?.url).toBe(
			"https://sandbox.zenodo.org/records/100",
		);
	});

	it("uses explicit Zenodo Extra record IDs before older DOI history", () => {
		const display = buildPublicationDisplay({
			extra: [
				"ZenodoArchiveID: 123",
				"ZenodoArchiveConcept: 100",
				"previousDOI: 10.5281/zenodo.999",
			].join("\n"),
		});

		expect(display.links.zenodoRecord?.value).toBe("123");
		expect(display.links.zenodoConceptRecord?.value).toBe("100");
	});

	it("keeps the Extra record when an older attachment points elsewhere", () => {
		const display = buildPublicationDisplay({
			extra: "Archive: https://zenodo.org/records/123",
			attachments: [
				{
					url: "https://zenodo.org/records/100",
					tags: ["_r:zenodorecord"],
				},
			],
		});

		expect(display.links.zenodoRecord?.value).toBe("123");
	});

	it("shows a real DOI beside a Zenodo DOI from Extra", () => {
		const display = buildPublicationDisplay({
			DOI: "10.1234/article",
			extra: "DOI: 10.5281/zenodo.123",
		});

		expect(display.bibliographicDoi.status).toBe("resolved");
		expect(display.links.bibliographicDoi?.value).toBe("10.1234/article");
		expect(display.links.zenodoVersionDoi?.value).toBe(
			"10.5281/zenodo.123",
		);
		expect(display.links.zenodoRecord?.value).toBe("123");
	});

	it("shows a tagged Zenodo DOI without treating it as a conflict", () => {
		const display = buildPublicationDisplay({
			DOI: "10.1234/article",
			attachments: [
				{
					url: "https://doi.org/10.5281/zenodo.456",
					tags: ["_r:doi"],
				},
			],
		});

		expect(display.bibliographicDoi.status).toBe("resolved");
		expect(display.links.bibliographicDoi?.value).toBe("10.1234/article");
		expect(display.links.zenodoVersionDoi?.value).toBe(
			"10.5281/zenodo.456",
		);
	});

	it("surfaces imported DOI conflicts while keeping managed links explicit", () => {
		const display = buildPublicationDisplay({
			DOI: "10.1234/one",
			extra: "DOI: 10.1234/two",
			publicationIdentifiers: {
				crossref: {
					doi: "10.1234/managed",
					lifecycle: "verified",
				},
			},
		});

		expect(display.bibliographicDoi.status).toBe("conflict");
		expect(display.links.crossrefDoi?.value).toBe("10.1234/managed");
	});
});
