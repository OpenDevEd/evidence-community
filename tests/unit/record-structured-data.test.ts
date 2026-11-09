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
		const data = recordStructuredData(record({ itemType: "Report", date: "sometime" }), "https://aied.openscholar.ai");
		expect(data["@type"]).toBe("Report");
		expect(data).not.toHaveProperty("datePublished");
		expect(data).not.toHaveProperty("author");
	});
});
