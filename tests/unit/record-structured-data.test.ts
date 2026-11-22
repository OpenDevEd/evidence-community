import { describe, expect, it } from "vitest";
import { recordStructuredData } from "@/lib/record-structured-data";
import type { Item } from "@/app/api/item/types";

const record = (fields: Partial<Item>) => ({ key: "ABCD1234", itemType: "JournalArticle", title: "Peer tutoring and reading", ...fields }) as Item;

describe("record structured data", () => {
	it("describes a journal article with its authors, journal, date and DOI", () => {
		const data = recordStructuredData(record({
			creators: [{ creatorType: "author", firstName: "Ana", lastName: "Ruiz" }, { creatorType: "editor", name: "Not An Author" }],
			publicationTitle: "Journal of Reading",
			date: "2021-05-05",
			DOI: "https://doi.org/10.1000/xyz",
		}), "https://aied.openscholar.ai");
		expect(data).toMatchObject({
			"@type": "ScholarlyArticle",
			url: "https://aied.openscholar.ai/lib/ABCD1234",
			author: [{ "@type": "Person", name: "Ana Ruiz" }],
			isPartOf: { "@type": "Periodical", name: "Journal of Reading" },
			datePublished: "2021-05-05",
			sameAs: "https://doi.org/10.1000/xyz",
		});
	});

	it("names other kinds of work by their own type and leaves out what the record lacks", () => {
		const data = recordStructuredData(record({ itemType: "Report", date: "sometime", publicationTitle: "Series", creators: [{ creatorType: "author", name: "UNESCO" }] }), "https://aied.openscholar.ai");
		expect(data["@type"]).toBe("Report");
		expect(data).not.toHaveProperty("datePublished");
		expect(data).not.toHaveProperty("isPartOf");
		// A one-field name is how OpenAlex records name people, so it stays a person.
		expect(data.author).toEqual([{ "@type": "Person", name: "UNESCO" }]);
		expect(recordStructuredData(record({ date: "2021-05" }), "https://aied.openscholar.ai").datePublished).toBe("2021-05");
	});

	// Google's Dataset rich result needs a description and reads its people from creator (Search Console, 21 November 2026).
	it("gives a dataset the description and creator Google reads", () => {
		const data = recordStructuredData(record({ itemType: "Dataset", abstractNote: "Transcripts of fifteen interviews.", creators: [{ creatorType: "author", name: "Irina Zlotnikova" }] }), "https://aied.openscholar.ai");
		expect(data).toMatchObject({ "@type": "Dataset", description: "Transcripts of fifteen interviews.", creator: [{ "@type": "Person", name: "Irina Zlotnikova" }] });
	});

	it("names an author an editor picked as an organisation an organisation", () => {
		const data = recordStructuredData(record({ itemType: "Dataset", creators: [{ creatorType: "author", name: "Kenya Bureau of Statistics", organization: true }, { creatorType: "author", name: "Ana Ruiz" }] }), "https://aied.openscholar.ai");
		expect(data.creator).toEqual([{ "@type": "Organization", name: "Kenya Bureau of Statistics" }, { "@type": "Person", name: "Ana Ruiz" }]);
	});

	it("links the record's licence to its terms", () => {
		const data = recordStructuredData(record({ licence: { kind: "zenodo", id: "cc-by-4.0" } }), "https://aied.openscholar.ai");
		expect(data.license).toMatch(/creativecommons\.org\/licenses\/by\/4\.0/);
		// Zenodo has no terms address for a closed licence, so it goes by its name.
		expect(recordStructuredData(record({ licence: { kind: "zenodo", id: "other-closed" } }), "https://aied.openscholar.ai").license).toEqual({ "@type": "CreativeWork", name: "Other (Not Open)" });
	});
});
