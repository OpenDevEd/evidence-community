import { describe, expect, it } from "vitest";

import { duplicateWorkKeys, uncertainDuplicateDois } from "@/lib/source-ingestion/openalex/duplicates";

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
});
