import { describe, expect, it } from "vitest";

import {
	applySandboxDraftChanges,
	assertSandboxConfiguration,
	zenodoFile,
} from "../../tools/publicationSandboxQualification";

describe("publication sandbox qualification", () => {
	const expected = {baseUrl: "https://sandbox.example.org", libraryId: "qa-library", prefix: "10.53832", namespace: "qa."};
	const configuration = {...expected, crossrefEnvironment: "test" as const, zenodoEnvironment: "sandbox" as const};
	it("accepts the explicitly confirmed library and sandbox providers", () => {
		expect(() => assertSandboxConfiguration(configuration, expected)).not.toThrow();
	});
	it.each([
		{libraryId: "another-library"},
		{baseUrl: "https://another.example.org"},
		{crossrefEnvironment: "production" as const},
		{zenodoEnvironment: "production" as const},
		{prefix: "10.99999"},
		{namespace: "another."},
	])("rejects an unconfirmed runtime before qualification writes: %j", changes => {
		expect(() => assertSandboxConfiguration({...configuration, ...changes}, expected)).toThrow();
	});
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
