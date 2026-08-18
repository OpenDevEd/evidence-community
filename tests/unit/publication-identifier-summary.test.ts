import { describe, expect, it } from "vitest";

import { buildPublicationDisplay } from "@/lib/publication/publication-display-adapter";
import { buildPublicationIdentifierSummary } from "@/lib/publication/publication-identifier-summary";

describe("buildPublicationIdentifierSummary", () => {
	it("classifies one reused DOI as Crossref and keeps the Zenodo records", () => {
		const summary = buildPublicationIdentifierSummary({
			identifiers: [
				{
					doi: "10.53832/docs-pen.000002",
					lifecycle: "verified",
					registrar: "crossref",
					role: "primary",
				},
				{
					doi: "10.53832/docs-pen.000002",
					lifecycle: "verified",
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
						registrar: "zenodo",
						role: "version",
					},
					{
						doi: "10.5281/zenodo.700001",
						lifecycle: "verified",
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
});
