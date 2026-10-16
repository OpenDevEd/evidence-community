import { describe, expect, it } from "vitest";

import { filterPublicAttachments } from "@/lib/attachment-visibility";
import { publicTagRules } from "@/lib/tags";

const rules = publicTagRules({
	content: { tags: { hidden: ["hide"] } },
	sources: [
		{ key: "zotero-1", provider: "zotero", settings: { pdfPublishing: { mode: "every", tags: ["approved"] } } },
		{ key: "openalex", provider: "openalex", settings: {} },
	],
});
const notes = [
	{ key: "TAGGED01", deleted: 0, itemType: "Note", note: "<p>Tagged</p>", tags: ["approved"] },
	{ key: "PLAIN001", deleted: 0, itemType: "Note", note: "<p>Plain</p>", tags: [] },
	{ key: "HIDDEN01", deleted: 0, itemType: "Note", note: "<p>Hidden</p>", tags: ["approved", "hide"] },
];
const shown = (sourceConnectionKey: string) =>
	filterPublicAttachments(notes, rules, sourceConnectionKey)?.map((attachment) => attachment.key);

describe("which notes a record shows", () => {
	it("shows a Zotero record's notes that carry one of its source's publish tags, whatever its PDF rule", () => {
		expect(shown("zotero-1")).toEqual(["TAGGED01"]);
	});

	it("shows every note the library made itself, except hidden ones", () => {
		expect(shown("native")).toEqual(["TAGGED01", "PLAIN001"]);
	});

	it("shows no note from a source without publish tags, or one no longer configured", () => {
		expect(shown("openalex")).toEqual([]);
		expect(shown("zotero-removed")).toEqual([]);
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
		expect(filterPublicAttachments(links, rules, "zotero-1")?.map((link) => link.key)).toEqual(["TAGGEDLK", "DOILINKA", "PDFLINKA"]);
	});
});
