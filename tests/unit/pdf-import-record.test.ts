import { describe, expect, it } from "vitest";

import { zoteroItemFrom, type ReadRecord } from "@/lib/admin/pdf-import-record";

const read: ReadRecord = {
	creators: [
		{ affiliations: ["Universiti Sains Malaysia", " ", "Universiti Sains Malaysia"], creatorType: "author", firstName: "Wenxuan", lastName: "Wang", profileId: "profile_1" },
		{ affiliations: [], creatorType: "author", firstName: "Yan", lastName: "Peng", profileId: "profile_invented" },
	],
	fields: [
		{ field: "publicationTitle", value: "Journal of Educational Computing Research" },
		{ field: "rights", value: "© The Author(s) 2025" },
		{ field: "language", value: "en" },
		{ field: "reportNumber", value: "not a journal article field" },
	],
	itemType: "journalArticle",
	tags: ["personalized feedback", " ", "personalized feedback", "x".repeat(256)],
	title: "The Effectiveness of AI-Supported Personalized Feedback",
};

describe("a record read from a PDF", () => {
	it("keeps each author's affiliations, and a profile only when a search found it", () => {
		const item = zoteroItemFrom(read, { cites: [], profiles: new Set(["profile_1"]) });
		expect(item.creators).toEqual([
			{ authorProfileId: "profile_1", creatorType: "author", firstName: "Wenxuan", institutions: [{ display_name: "Universiti Sains Malaysia" }], lastName: "Wang" },
			{ creatorType: "author", firstName: "Yan", lastName: "Peng" },
		]);
	});

	it("takes the PDF's keywords as tags and links the records it cites", () => {
		const item = zoteroItemFrom(read, { cites: ["ABCD2345"], profiles: new Set() });
		expect(item.tags).toEqual([{ tag: "personalized feedback" }]);
		expect(item.links).toEqual({ cites: ["ABCD2345"] });
	});

	it("keeps only the fields its type has", () => {
		const item = zoteroItemFrom(read, { cites: [], profiles: new Set() });
		expect(item).toMatchObject({ itemType: "journalArticle", language: "en", publicationTitle: "Journal of Educational Computing Research", rights: "© The Author(s) 2025" });
		expect(item).not.toHaveProperty("reportNumber");
		expect(item).not.toHaveProperty("links");
	});

	it("files a type it doesn't know as a document", () => {
		expect(zoteroItemFrom({ ...read, itemType: "blogPostAboutCats" }, { cites: [], profiles: new Set() }).itemType).toBe("document");
	});
});
