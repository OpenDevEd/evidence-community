import { describe, expect, it } from "vitest";

import { dataCiteVersions, duplicateWorkKeys, planDuplicates, uncertainDuplicateDois, workFacts } from "@/lib/source-ingestion/openalex/duplicates";

const work = (key: string, doi: string | null, title = "TVET teachers in Ethiopia", date = "2026-09-28", author: string | null = null) => ({
	key,
	doi,
	title,
	date,
	author,
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

	it("keeps the unversioned DOI over a Mendeley Data or registry version, and the later of two figshare versions", () => {
		const title = "A dataset on technology acceptance";
		const records = [
			work("W1", "10.17632/khd668z4vr.1", title),
			work("W2", "10.17632/khd668z4vr", title),
			work("W3", "10.1257/rct.19229-1.0", "A tutoring trial"),
			work("W4", "10.1257/rct.19229", "A tutoring trial"),
			work("W5", "10.6084/m9.figshare.334.v1", "Survey data"),
			work("W6", "10.6084/m9.figshare.334.v3", "Survey data"),
		];
		expect(duplicateWorkKeys(records, new Map())).toEqual(new Map([["W1", "W2"], ["W3", "W4"], ["W5", "W6"]]));
		// Two Zenodo DOIs also differ only in a number; without DataCite's word they stay apart.
		expect(duplicateWorkKeys([work("W7", "10.5281/zenodo.491"), work("W8", "10.5281/zenodo.492")], new Map())).toEqual(new Map());
		// A chapter named like its book is not a version of the book.
		expect(duplicateWorkKeys([work("W9", "10.4324/9781003483977-2"), work("W10", "10.4324/9781003483977")], new Map())).toEqual(new Map());
	});

	it("compares versions uploaded on different days when they have the same first author", () => {
		const first = work("W1", "10.5281/zenodo.491", undefined, "2026-09-12", "https://openalex.org/A1");
		const later = work("W2", "10.5281/zenodo.492", undefined, "2026-09-20", "https://openalex.org/A1");
		const other = work("W3", "10.5281/zenodo.777", undefined, "2026-09-25", "https://openalex.org/A2");
		const versionOf = new Map([["10.5281/zenodo.492", new Set(["10.5281/zenodo.491"])], ["10.5281/zenodo.777", new Set(["10.5281/zenodo.491"])]]);
		expect(uncertainDuplicateDois([first, later, other])).toEqual(["10.5281/zenodo.491", "10.5281/zenodo.492"]);
		// Another author's upload on another day is never asked about, whatever DataCite would say.
		expect(duplicateWorkKeys([first, later, other], versionOf)).toEqual(new Map([["W2", "W1"]]));
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
				authorships: [{ author: { id: "https://openalex.org/A1" } }, { author: { id: "https://openalex.org/A2" } }],
			}),
		).toEqual({ key: "W2", doi: "10.5281/zenodo.492", title: "TVET teachers in Ethiopia", date: "2026-09-28", author: "https://openalex.org/A1", dataCite: true });
	});

	describe("a pass over live records and the works this run skipped", () => {
		const concept = { ...work("W1", "10.5281/zenodo.491"), itemKey: "ITEM0001" };
		const version = work("W2", "10.5281/zenodo.492");
		const versionOf = new Map([["10.5281/zenodo.492", new Set(["10.5281/zenodo.491"])]]);

		it("withdraws a live repeat and keeps a skipped one skipped while the record kept instead is live", () => {
			expect(planDuplicates([concept, { ...version, itemKey: "ITEM0002" }], [], versionOf, new Set())).toEqual({
				withdraw: [{ recordKey: "W2", itemKey: "ITEM0002", keptItemKey: "ITEM0001" }],
				keepSkipped: [],
				release: [],
			});
			expect(planDuplicates([concept], [version], versionOf, new Set())).toEqual({
				withdraw: [],
				keepSkipped: [{ recordKey: "W2", itemKey: "ITEM0001", keptItemKey: "ITEM0001" }],
				release: [],
			});
		});

		it("brings a skipped work back once it no longer repeats a live record, unless DataCite did not answer for it", () => {
			// The record kept instead left, or DataCite no longer links them.
			expect(planDuplicates([], [version], versionOf, new Set()).release).toEqual(["W2"]);
			expect(planDuplicates([concept], [version], new Map(), new Set()).release).toEqual(["W2"]);
			expect(planDuplicates([concept], [version], new Map(), new Set(["10.5281/zenodo.492"])).release).toEqual([]);
		});

		it("lets a failed DataCite lookup hold back only the repeats that needed it", () => {
			// A figshare .v1 whose unversioned DOI left, while an unrelated Zenodo pair could not be checked.
			const figshareVersion = work("W8", "10.26181/32278425.v1", "Figshare study");
			const liveZenodo = { ...work("W5", "10.5281/zenodo.700", "Zenodo study"), itemKey: "ITEM0005" };
			const skippedZenodo = work("W6", "10.5281/zenodo.701", "Zenodo study");
			expect(planDuplicates([liveZenodo], [figshareVersion, skippedZenodo], new Map(), new Set(["10.5281/zenodo.700", "10.5281/zenodo.701"])).release).toEqual(["W8"]);
		});

		it("never withdraws a live record for a work that is not live", () => {
			const skippedConcept = work("W1", "10.5281/zenodo.491");
			const liveVersion = { ...version, itemKey: "ITEM0002" };
			expect(planDuplicates([liveVersion], [skippedConcept], versionOf, new Set()).withdraw).toEqual([]);
		});
	});

	describe("asking DataCite", () => {
		const record = (doi: string, concept?: string) => ({
			attributes: { doi, relatedIdentifiers: concept ? [{ relationType: "IsVersionOf", relatedIdentifier: concept, relatedIdentifierType: "DOI" }] : [] },
		});
		const dois = (count: number, from: number) => Array.from({ length: count }, (_, index) => `10.5281/zenodo.${from + index}`);
		const sleeps: number[] = [];
		const sleep = async (ms: number) => {
			sleeps.push(ms);
		};

		it("tries a batch DataCite fails again, backing off", async () => {
			let calls = 0;
			const fetchImpl = (async () => (++calls < 3 ? new Response("Bad gateway", { status: 502 }) : Response.json({ data: [record("10.5281/zenodo.492", "10.5281/zenodo.491")] }))) as typeof fetch;
			sleeps.length = 0;
			const result = await dataCiteVersions(["10.5281/zenodo.492", "10.5281/zenodo.491"], fetchImpl, sleep);
			expect(result.versionsOf).toEqual(new Map([["10.5281/zenodo.492", new Set(["10.5281/zenodo.491"])]]));
			expect(result.unresolved).toEqual(new Set());
			expect(sleeps).toEqual([1_000, 2_000]);
		});

		it("leaves only a batch DataCite never answers undecided, and does not retry a refused request", async () => {
			const first = dois(50, 1000);
			const second = dois(10, 2000);
			let refusedCalls = 0;
			const fetchImpl = (async (input: RequestInfo | URL) => {
				const ids = new URL(String(input)).searchParams.get("ids")!.split(",");
				return ids[0] === first[0] ? new Response("Bad gateway", { status: 502 }) : Response.json({ data: [record(second[1]!, second[0])] });
			}) as typeof fetch;
			const result = await dataCiteVersions([...first, ...second], fetchImpl, sleep);
			expect(result.unresolved).toEqual(new Set(first));
			expect(result.versionsOf).toEqual(new Map([[second[1], new Set([second[0]])]]));

			const refusing = (async () => {
				refusedCalls++;
				return new Response("Bad request", { status: 400 });
			}) as typeof fetch;
			expect((await dataCiteVersions(second, refusing, sleep)).unresolved).toEqual(new Set(second));
			expect(refusedCalls).toBe(1);
		});

		it("stops asking once DataCite is down, and says why", async () => {
			const asked = dois(500, 3000);
			let calls = 0;
			const down = (async () => {
				calls++;
				return new Response("Bad gateway", { status: 502 });
			}) as typeof fetch;
			const result = await dataCiteVersions(asked, down, sleep);
			expect(result.unresolved).toEqual(new Set(asked));
			expect(result.failure).toContain("502");
			// Three batches of five tries each, then the other seven batches are not asked for.
			expect(calls).toBe(15);
		});
	});
});
