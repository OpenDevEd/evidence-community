import assert from "node:assert/strict";
import test from "node:test";
import { resolveCitationDisplayMode } from "./citationMode.mts";

test("uses the normal citation mode when the control tag is absent", () => {
	assert.deepEqual(
		resolveCitationDisplayMode({
			DOI: "10.1234/example",
			tags: [],
		}),
		{ mode: "citation" },
	);
});

test("normalizes a DOI from the Zotero DOI field", () => {
	assert.deepEqual(
		resolveCitationDisplayMode({
			DOI: "https://doi.org/10.1234/EXAMPLE",
			tags: ["_citation_doi_only"],
		}),
		{
			mode: "doi-only",
			link: {
				provider: "crossref",
				kind: "doi",
				label: "Crossref DOI",
				value: "10.1234/example",
				url: "https://doi.org/10.1234/example",
			},
		},
	);
});

test("normalizes a DOI from the Zotero Extra field", () => {
	const result = resolveCitationDisplayMode({
		extra: "Unmanaged: value\nDOI: doi:10.5678/EXTRA",
		tags: ["_CITATION_DOI_ONLY"],
	});

	assert.equal(result.mode, "doi-only");
	assert.deepEqual(result.mode === "doi-only" ? result.link : null, {
		provider: "crossref",
		kind: "doi",
		label: "Crossref DOI",
		value: "10.5678/extra",
		url: "https://doi.org/10.5678/extra",
	});
});

test("prefers the dedicated DOI field when both sources contain a DOI", () => {
	const result = resolveCitationDisplayMode({
		DOI: "10.1111/primary",
		extra: "DOI: 10.2222/secondary",
		tags: ["_citation_doi_only"],
	});

	assert.equal(
		result.mode === "doi-only" ? result.link?.value : null,
		"10.1111/primary",
	);
});

test("does not fall back to a full citation when the tagged item has no valid DOI", () => {
	assert.deepEqual(
		resolveCitationDisplayMode({
			DOI: "not-a-doi",
			extra: "DOI: also-not-a-doi",
			tags: ["_citation_doi_only"],
		}),
		{ mode: "doi-only", link: null },
	);
});
