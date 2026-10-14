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
	// An editor's link renames the author to the profile; the read links the same way.
	it("keeps each author's affiliations, and links a profile only when a search found it, under the profile's name", () => {
		const item = zoteroItemFrom(read, { cites: [], profiles: new Map([["profile_1", { id: "profile_1", name: "Wang Wenxuan", searches: ["Wenxuan Wang"] }]]) });
		expect(item.creators).toEqual([
			{ authorProfileId: "profile_1", creatorType: "author", firstName: "", institutions: [{ display_name: "Universiti Sains Malaysia" }], lastName: "Wang Wenxuan" },
			{ creatorType: "author", firstName: "Yan", lastName: "Peng" },
		]);
	});

	// The AI can mix up whose profile a search found; the profile goes only to the author it was searched for.
	it("doesn't give one author the profile a search for another author found", () => {
		const mixed = { ...read, creators: [{ ...read.creators[0]!, profileId: "profile_peng" }] };
		const item = zoteroItemFrom(mixed, { cites: [], profiles: new Map([["profile_peng", { id: "profile_peng", name: "Yan Peng", searches: ["Yan Peng"] }]]) });
		expect(item.creators).toEqual([{ creatorType: "author", firstName: "Wenxuan", institutions: [{ display_name: "Universiti Sains Malaysia" }], lastName: "Wang" }]);
	});

	it("takes the PDF's keywords as tags and links the records it cites", () => {
		const item = zoteroItemFrom(read, { cites: ["ABCD2345"], profiles: new Map() });
		expect(item.tags).toEqual([{ tag: "personalized feedback" }]);
		expect(item.links).toEqual({ cites: ["ABCD2345"] });
	});

	it("keeps only the fields its type has", () => {
		const item = zoteroItemFrom(read, { cites: [], profiles: new Map() });
		expect(item).toMatchObject({ itemType: "journalArticle", language: "en", publicationTitle: "Journal of Educational Computing Research", rights: "© The Author(s) 2025" });
		expect(item).not.toHaveProperty("reportNumber");
		expect(item).not.toHaveProperty("links");
	});

	it("files a type it doesn't know as a document", () => {
		expect(zoteroItemFrom({ ...read, itemType: "blogPostAboutCats" }, { cites: [], profiles: new Map() }).itemType).toBe("document");
	});
});
