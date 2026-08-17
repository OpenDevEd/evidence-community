import { describe, expect, it } from "vitest";

import { applySandboxDraftChanges } from "../../tools/publicationSandboxQualification";

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
});
