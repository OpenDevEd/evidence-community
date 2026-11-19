import { describe, expect, it } from "vitest";

import { filterPublicAttachments } from "@/lib/attachment-visibility";
import { publicTagRules } from "@/lib/tags";

const rules = publicTagRules({
	content: { tags: { hidden: ["hide"], publish: ["library-publish"] } },
	sources: [
		{ key: "zotero-1", provider: "zotero", settings: { pdfPublishing: { mode: "every", tags: ["approved"] } } },
		{ key: "openalex", provider: "openalex", settings: {} },
	],
});
const notes = [
	{ key: "TAGGED01", deleted: 0, itemType: "Note", note: "<p>Tagged</p>", tags: ["approved"] },
	{ key: "PLAIN001", deleted: 0, itemType: "Note", note: "<p>Plain</p>", tags: [] },
	{ key: "LIBRARY1", deleted: 0, itemType: "Note", note: "<p>Library</p>", tags: ["library-publish"] },
	{ key: "HIDDEN01", deleted: 0, itemType: "Note", note: "<p>Hidden</p>", tags: ["approved", "hide"] },
];
const shown = (sourceConnectionKey: string) =>
	filterPublicAttachments({ attachmentsData: notes, sourceConnectionKey }, rules)?.map((attachment) => attachment.key);

describe("which notes a record shows", () => {
	it("shows a Zotero record's notes that carry one of its source's publish tags, whatever its PDF rule", () => {
		expect(shown("zotero-1")).toEqual(["TAGGED01"]);
	});

	it("shows a library-made record's notes that carry the library's publish tags", () => {
		expect(shown("native")).toEqual(["LIBRARY1"]);
	});

	it("shows no note from a source without publish tags, or one no longer configured", () => {
		expect(shown("openalex")).toEqual([]);
		expect(shown("zotero-removed")).toEqual([]);
		// A source key may share a name with an object's built-in properties.
		expect(shown("constructor")).toEqual([]);
	});
});

describe("which links a record shows", () => {
	const links = [
		{ key: "TAGGEDLK", deleted: 0, itemType: "Attachment", linkMode: "linked_url", url: "https://example.org/a", tags: ["approved"] },
		{ key: "PRIVATLK", deleted: 0, itemType: "Attachment", linkMode: "linked_url", url: "https://example.org/b", tags: [] },
		{ key: "DOILINKA", deleted: 0, itemType: "Attachment", linkMode: "linked_url", url: "https://doi.org/10.5555/x", tags: ["_r:doi"] },
		{ key: "PDFLINKA", deleted: 0, itemType: "Attachment", linkMode: "linked_url", url: "https://example.org/c.pdf", contentType: "application/pdf", tags: [] },
	];

	it("keeps a Zotero record's tagged links, identifier links and PDF links, and drops its private ones", () => {
		expect(filterPublicAttachments({ attachmentsData: links, sourceConnectionKey: "zotero-1" }, rules)?.map((link) => link.key)).toEqual(["TAGGEDLK", "DOILINKA", "PDFLINKA"]);
	});
});
