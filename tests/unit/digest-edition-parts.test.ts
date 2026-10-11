import { describe, expect, it } from "vitest";

import { editionParts } from "@/components/digests/edition-parts";

describe("cutting a digest's text into the sections its contents list", () => {
	it("makes each subject heading a section with the publications it cites counted once", () => {
		const { intro, parts } = editionParts(
			"An opening line.\n\n## Heat and health\n\nOne [Lee, 2026](/lib/ABCD1234) and again [Lee](/lib/ABCD1234).\n\n## Flood risk\n\nSee [Ali](/lib/EFGH5678 \"A study\").",
		);
		expect(intro).toBe("An opening line.");
		expect(parts.map(({ id, title, cited }) => [id, title, cited])).toEqual([
			["section-heat-and-health", "Heat and health", 1],
			["section-flood-risk", "Flood risk", 1],
		]);
	});

	// The writer is asked for plain headings; one that comes back marked up or underlined is still a section.
	it("reads a marked-up or underlined heading as plain text", () => {
		const { parts } = editionParts("## **Schools**\n\nText.\n\nHealth `care`\n-------\n\nMore.\n\n## [Water](/lib/ABCD1234)\n\nLast.");
		expect(parts.map(({ title }) => title)).toEqual(["Schools", "Health care", "Water"]);
	});

	it("reads an indented heading and one with closing hashes", () => {
		const { intro, parts } = editionParts("Opening.\n\n   ## Health\n\nText.\n\n## Water ##\n\nMore.");
		expect(intro).toBe("Opening.");
		expect(parts.map(({ title }) => title)).toEqual(["Health", "Water"]);
	});

	it("gives two sections with one title different addresses", () => {
		const { parts } = editionParts("## Schools\n\nOne.\n\n## Schools\n\nTwo.");
		expect(parts.map(({ id }) => id)).toEqual(["section-schools", "section-schools-2"]);
	});
});
