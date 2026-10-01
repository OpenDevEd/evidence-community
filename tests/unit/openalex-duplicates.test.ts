import { describe, expect, it } from "vitest";

import { duplicateWorkKeys, planDuplicates, uncertainDuplicateDois, workFacts } from "@/lib/source-ingestion/openalex/duplicates";

const work = (key: string, doi: string | null, title = "TVET teachers in Ethiopia", date = "2026-09-28") => ({
	key,
	doi,
	title,
	date,
	dataCite: true,
});

describe("OpenAlex duplicate records", () => {
	it("keeps a Zenodo concept DOI over the version DataCite records as one of its versions, in either order", () => {
		const concept = work("W1", "10.5281/zenodo.491");
		const version = work("W2", "10.5281/zenodo.492");
		const versionOf = new Map([["10.5281/zenodo.492", new Set(["10.5281/zenodo.491"])]]);
		expect(uncertainDuplicateDois([version, concept])).toEqual(["10.5281/zenodo.492", "10.5281/zenodo.491"]);
		expect(duplicateWorkKeys([version, concept], versionOf)).toEqual(new Map([["W2", "W1"]]));
		expect(duplicateWorkKeys([concept, version], versionOf)).toEqual(new Map([["W2", "W1"]]));
	});

	it("keeps an unversioned figshare DOI over its .v1 copy without asking DataCite", () => {
		const base = work("W1", "10.26181/32278425");
		const version = work("W2", "10.26181/32278425.v1");
		expect(uncertainDuplicateDois([version, base])).toEqual([]);
		expect(duplicateWorkKeys([version, base], new Map())).toEqual(new Map([["W2", "W1"]]));
	});

	it("keeps the cleanly written DOI when OpenAlex wrote the same DOI two ways", () => {
		const records = [
			work("W1", "10.61242/10.61242/ijabo.23.261"),
			work("W9", "10.61242/ijabo.23.261"),
			work("W3", "10.36470/famen.2023l13.", "Other title"),
			work("W4", "10.36470/famen.2023l13", "Other title"),
		];
		expect(duplicateWorkKeys(records, new Map())).toEqual(new Map([["W1", "W9"], ["W3", "W4"]]));
	});

	it("points every repeat at the record finally kept", () => {
		// A version of a concept DOI that OpenAlex also wrote with a trailing dot.
		const records = [work("W1", "10.5281/zenodo.491"), work("W2", "10.5281/zenodo.491."), work("W3", "10.5281/zenodo.492")];
		const versionOf = new Map([["10.5281/zenodo.492", new Set(["10.5281/zenodo.491"])]]);
		expect(duplicateWorkKeys(records, versionOf)).toEqual(new Map([["W2", "W1"], ["W3", "W1"]]));
	});

	it("keeps records that only share a title and date, or whose DOIs DataCite does not link", () => {
		const records = [
			work("W1", "10.35534/tppc.0605032"),
			work("W2", "10.35534/tppc.0604032"),
			work("W3", "10.5281/zenodo.500", "Same", "2026-01-01"),
			work("W4", "10.5281/zenodo.900", "Same", "2026-01-01"),
			work("W5", "10.5281/zenodo.492", "TVET teachers in Ethiopia", "2026-09-29"),
			work("W6", null),
		];
		expect(duplicateWorkKeys(records, new Map())).toEqual(new Map());
	});

	it("asks DataCite only about pairs registered with it", () => {
		const crossref = { ...work("W1", "10.1234/journal.1"), dataCite: false };
		expect(uncertainDuplicateDois([crossref, work("W2", "10.1234/journal.2")])).toEqual([]);
	});

	it("compares what OpenAlex says, not the library's edited fields", () => {
		expect(
			workFacts({
				id: "https://openalex.org/W2",
				doi: null,
				ids: { doi: "https://doi.org/10.5281/ZENODO.492" },
				title: null,
				display_name: "TVET teachers in Ethiopia",
				publication_date: "2026-09-28",
				indexed_in: ["datacite"],
			}),
		).toEqual({ key: "W2", doi: "10.5281/zenodo.492", title: "TVET teachers in Ethiopia", date: "2026-09-28", dataCite: true });
	});

	describe("a pass over live records and the works this run skipped", () => {
		const concept = { ...work("W1", "10.5281/zenodo.491"), itemKey: "ITEM0001" };
		const version = work("W2", "10.5281/zenodo.492");
		const versionOf = new Map([["10.5281/zenodo.492", new Set(["10.5281/zenodo.491"])]]);

		it("withdraws a live repeat and keeps a skipped one skipped while the record kept instead is live", () => {
			expect(planDuplicates([concept, { ...version, itemKey: "ITEM0002" }], [], versionOf, false)).toEqual({
				withdraw: [{ recordKey: "W2", itemKey: "ITEM0002", keptItemKey: "ITEM0001" }],
				keepSkipped: [],
				release: [],
			});
			expect(planDuplicates([concept], [version], versionOf, false)).toEqual({
				withdraw: [],
				keepSkipped: [{ recordKey: "W2", itemKey: "ITEM0001", keptItemKey: "ITEM0001" }],
				release: [],
			});
		});

		it("brings a skipped work back once it no longer repeats a live record, unless DataCite could not be asked", () => {
			// The record kept instead left, or DataCite no longer links them.
			expect(planDuplicates([], [version], versionOf, false).release).toEqual(["W2"]);
			expect(planDuplicates([concept], [version], new Map(), false).release).toEqual(["W2"]);
			expect(planDuplicates([concept], [version], new Map(), true).release).toEqual([]);
		});

		it("lets a failed DataCite lookup hold back only the repeats that needed it", () => {
			// A figshare .v1 whose unversioned DOI left, while an unrelated Zenodo pair could not be checked.
			const figshareVersion = work("W8", "10.26181/32278425.v1", "Figshare study");
			const liveZenodo = { ...work("W5", "10.5281/zenodo.700", "Zenodo study"), itemKey: "ITEM0005" };
			const skippedZenodo = work("W6", "10.5281/zenodo.701", "Zenodo study");
			expect(planDuplicates([liveZenodo], [figshareVersion, skippedZenodo], new Map(), true).release).toEqual(["W8"]);
		});

		it("never withdraws a live record for a work that is not live", () => {
			const skippedConcept = work("W1", "10.5281/zenodo.491");
			const liveVersion = { ...version, itemKey: "ITEM0002" };
			expect(planDuplicates([liveVersion], [skippedConcept], versionOf, false).withdraw).toEqual([]);
		});
	});
});
