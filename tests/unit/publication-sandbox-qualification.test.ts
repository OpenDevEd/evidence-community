import { describe, expect, it } from "vitest";

import {
	applySandboxDraftChanges,
	zenodoFile,
} from "../../tools/publicationSandboxQualification";

describe("publication sandbox qualification", () => {
	it("keeps the full draft payload when changing metadata", () => {
		expect(
			applySandboxDraftChanges(
				{
					itemType: "Report",
					title: "Before",
					date: "2026-08-17",
					publisher: "OpenDevEd",
				},
				{ title: "After" },
			),
		).toEqual({
			itemType: "Report",
			title: "After",
			date: "2026-08-17",
			publisher: "OpenDevEd",
		});
	});

	it("finds a PDF in Zenodo's published record response", () => {
		expect(
			zenodoFile(
				{
					files: [
						{
							key: "article.pdf",
							size: 903,
							checksum: "md5:20f667ef5a783ccea467cae711ebb579",
						},
					],
				},
				"article.pdf",
			),
		).toMatchObject({ key: "article.pdf", size: 903 });
	});
});
