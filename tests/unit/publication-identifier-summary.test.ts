import { filterPublicAttachments } from "@/lib/attachment-visibility";
import { describe, expect, it } from "vitest";

import { buildPublicationDisplay } from "@/lib/publication/publication-display-adapter";
import { buildPublicationIdentifierSummary, resolvePublicDoi } from "@/lib/publication/publication-identifier-summary";

describe("buildPublicationIdentifierSummary", () => {
	it("classifies one reused DOI as Crossref and keeps the Zenodo records", () => {
		const summary = buildPublicationIdentifierSummary({
			identifiers: [
				{
					doi: "10.53832/docs-pen.000002",
					lifecycle: "verified",
					ownership: "managed",
					registrar: "crossref",
					role: "primary",
				},
				{
					doi: "10.53832/docs-pen.000002",
					lifecycle: "verified",
					ownership: "managed",
					registrar: "zenodo",
					role: "version",
				},
			],
			zenodoState: {
				environment: "sandbox",
				zenodoParentId: "588742",
				zenodoRecordId: "588743",
			},
		});

		expect(summary).toEqual({
			crossref: {
				doi: "10.53832/docs-pen.000002",
				lifecycle: "verified",
			},
			zenodo: {
				versionDoi: "10.53832/docs-pen.000002",
				recordId: "588743",
				conceptRecordId: "588742",
				baseUrl: "https://sandbox.zenodo.org",
			},
		});
		expect(
			buildPublicationDisplay({
				DOI: "10.53832/docs-pen.000002",
				publicationIdentifiers: summary,
			}).links.links,
		).toEqual([
			{
				provider: "crossref",
				kind: "doi",
				label: "Crossref DOI",
				value: "10.53832/docs-pen.000002",
				url: "https://doi.org/10.53832/docs-pen.000002",
			},
			{
				provider: "zenodo",
				kind: "record",
				label: "Zenodo archive",
				value: "588743",
				url: "https://sandbox.zenodo.org/records/588743",
			},
			{
				provider: "zenodo",
				kind: "concept-record",
				label: "Zenodo concept record",
				value: "588742",
				url: "https://sandbox.zenodo.org/records/588742",
			},
		]);
	});

	it("keeps separately minted Zenodo version and concept DOIs", () => {
		expect(
			buildPublicationIdentifierSummary({
				identifiers: [
					{
						doi: "10.5281/zenodo.700002",
						lifecycle: "verified",
						ownership: "managed",
						registrar: "zenodo",
						role: "version",
					},
					{
						doi: "10.5281/zenodo.700001",
						lifecycle: "verified",
						ownership: "managed",
						registrar: "zenodo",
						role: "concept",
					},
				],
				zenodoState: {
					environment: "sandbox",
					zenodoParentId: "700001",
					zenodoRecordId: "700002",
				},
			}),
		).toEqual({
			zenodo: {
				versionDoi: "10.5281/zenodo.700002",
				conceptDoi: "10.5281/zenodo.700001",
				recordId: "700002",
				conceptRecordId: "700001",
				baseUrl: "https://sandbox.zenodo.org",
			},
		});
	});

	it("omits the summary when no managed public identifier exists", () => {
		expect(
			buildPublicationIdentifierSummary({
				identifiers: [],
				zenodoState: null,
			}),
		).toBeUndefined();
	});

	it("shows a DOI Zenodo archived under as the record's DOI, not a Zenodo DOI", () => {
		const summary = buildPublicationIdentifierSummary({
			identifiers: [
				{
					doi: "10.1016/j.cell.2013.05.039",
					lifecycle: "verified",
					ownership: "external",
					registrar: "zenodo",
					role: "version",
				},
			],
			zenodoState: {
				environment: "sandbox",
				zenodoParentId: "589936",
				zenodoRecordId: "589937",
			},
		});

		expect(summary).toEqual({
			zenodo: {
				recordId: "589937",
				conceptRecordId: "589936",
				baseUrl: "https://sandbox.zenodo.org",
			},
		});
	});
});

describe("public citation DOI", () => {
	it("checks attachment DOIs even when the parent has a managed Zenodo DOI", () => {
		for (const DOI of ["10.5281/zenodo.700001", "10.5281/zenodo.700002"]) {
			expect(resolvePublicDoi({
				DOI,
				attachments: [{ url: "https://doi.org/10.5555/article", tags: ["_r:doi"] }],
				publicationIdentifiers: { zenodo: {
					versionDoi: "10.5281/zenodo.700002", conceptDoi: "10.5281/zenodo.700001",
				} },
			})).toBe("10.5555/article");
		}
	});

	it("does not choose a DOI when the public bibliographic sources conflict", () => {
		expect(resolvePublicDoi({
			DOI: "10.5555/parent",
			attachments: [{ url: "https://doi.org/10.5555/attachment", tags: ["_r:doi"] }],
			publicationIdentifiers: { crossref: { doi: "10.5555/parent", lifecycle: "verified" } },
		})).toBeNull();
	});

	it("uses the registered Zenodo version, not its concept DOI", () => {
		expect(resolvePublicDoi({
			publicationIdentifiers: {
				zenodo: {
					versionDoi: "10.5281/zenodo.700002",
					conceptDoi: "10.5281/zenodo.700001",
				},
			},
		})).toBe("10.5281/zenodo.700002");
	});

	it("preserves an imported DOI and prefers a verified Crossref DOI over the archive DOI", () => {
		const publicationIdentifiers = {
			crossref: { doi: "10.5555/crossref", lifecycle: "verified" as const },
			zenodo: { versionDoi: "10.5281/zenodo.700002" },
		};
		expect(resolvePublicDoi({
			DOI: "https://doi.org/10.5555/imported", publicationIdentifiers,
		})).toBe("10.5555/imported");
		expect(resolvePublicDoi({
			extra: "DOI: 10.5555/imported", publicationIdentifiers,
		})).toBe("10.5555/imported");
		expect(resolvePublicDoi({ publicationIdentifiers })).toBe("10.5555/crossref");
	});

	it("uses the current version instead of an older managed Zenodo DOI", () => {
		expect(resolvePublicDoi({
			DOI: "10.5281/zenodo.700000",
			publicationIdentifiers: { zenodo: { versionDoi: "10.5281/zenodo.700002" } },
		})).toBe("10.5281/zenodo.700002");
	});

	it("does not cite a private reservation or a concept-only archive", () => {
		expect(resolvePublicDoi({
			publicationIdentifiers: { crossref: { doi: "10.5555/reserved", lifecycle: "reserved" } },
		})).toBeNull();
		expect(resolvePublicDoi({
			publicationIdentifiers: { zenodo: { conceptDoi: "10.5281/zenodo.700001" } },
		})).toBeNull();
		expect(buildPublicationIdentifierSummary({
			identifiers: [{
				doi: "10.5555/reserved", lifecycle: "reserved", ownership: "managed",
				registrar: "crossref", role: "primary",
			}],
			zenodoState: null,
		})).toBeUndefined();
	});
});

it("shows an allocated Crossref DOI only after it belongs to the approved record", () => {
	const crossref = {
		doi: "10.5555/allocated", lifecycle: "reserved" as const,
		ownership: "managed" as const, registrar: "crossref" as const, role: "primary" as const,
	};
	expect(buildPublicationIdentifierSummary({
		identifiers: [crossref], zenodoState: null, bibliographicDoi: crossref.doi,
	})?.crossref).toEqual({ doi: crossref.doi, lifecycle: "reserved" });
	expect(buildPublicationIdentifierSummary({
		identifiers: [crossref], zenodoState: null, bibliographicDoi: "10.5281/zenodo.700002",
	})).toBeUndefined();
});

it("does not cite a known concept DOI stored on the record", () => {
	expect(resolvePublicDoi({
		DOI: "10.5281/zenodo.700001",
		publicationIdentifiers: { zenodo: { conceptDoi: "10.5281/zenodo.700001" } },
	})).toBeNull();
});


it("uses tagged bibliographic attachments without treating ordinary URLs as DOIs", () => {
	expect(resolvePublicDoi({ attachments: [{ url: "https://doi.org/10.5555/attachment", tags: ["_r:doi"] }] })).toBe("10.5555/attachment");
	expect(resolvePublicDoi({ attachments: [{ url: "https://doi.org/10.5555/unrelated", tags: [] }] })).toBeNull();
});


it("excludes hidden attachment DOIs from search result exports", () => {
	const attachments = filterPublicAttachments({ sourceConnectionKey: "zotero-1", attachmentsData: [
		{ deleted: 0, url: "https://doi.org/10.5555/hidden", tags: ["_r:doi", "Hidden"] },
		{ deleted: 1, url: "https://doi.org/10.5555/deleted", tags: ["_r:doi"] },
	] }, { hidden: ["hidden"], publishBySource: {} });
	expect(attachments).toEqual([]);
	expect(resolvePublicDoi({ attachments })).toBeNull();
});
