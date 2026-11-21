import { describe, expect, it } from "vitest";

import type { Item } from "@/app/api/item/types";
import { recordStructuredData } from "@/lib/record-structured-data";

const record = (fields: Partial<Item>) =>
	({ key: "4FWAP2HX", title: "Interviews with doctoral students", abstractNote: "Transcripts of fifteen interviews.", creators: [{ creatorType: "author", name: "Irina Zlotnikova" }], ...fields }) as Item;

describe("a record as schema.org structured data", () => {
	// Google's Dataset rich result needs a description and reads its people from creator (Search Console, 21 November 2026).
	it("gives a dataset the description and creator Google reads", () => {
		const data = recordStructuredData(record({ itemType: "Dataset" }), "https://aied.openscholar.ai");
		expect(data).toMatchObject({ "@type": "Dataset", description: "Transcripts of fifteen interviews.", creator: [{ "@type": "Person", name: "Irina Zlotnikova" }] });
	});

	it("links the record's licence to its terms", () => {
		const data = recordStructuredData(record({ itemType: "Dataset", licence: { kind: "zenodo", id: "cc-by-4.0" } }), "https://aied.openscholar.ai");
		expect(data.license).toMatch(/creativecommons\.org\/licenses\/by\/4\.0/);
	});
});
