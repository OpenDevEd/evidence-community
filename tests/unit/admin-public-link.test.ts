import { describe, expect, it } from "vitest";

import { buildAdminPublicItemUrl } from "@/lib/admin/public-link";

const baseItem = {
	filePublication: null,
	itemType: "Book",
	key: "BOOK0001",
	parentItem: null,
	parentState: null,
	published: { title: "Published book" },
	sourceFileUrl: null,
	state: "published" as const,
};

describe("buildAdminPublicItemUrl", () => {
	it("uses the public item page for a published record", () => {
		expect(
			buildAdminPublicItemUrl(baseItem, "https://library.example.org"),
		).toBe("https://library.example.org/lib/BOOK0001");
	});

	it.each([
		["managed PDF", { filePublication: {} }],
		["source PDF", { sourceFileUrl: "https://storage.example/file.pdf" }],
	])("uses the website download route for a published %s", (_, file) => {
		expect(
			buildAdminPublicItemUrl(
				{
					...baseItem,
					...file,
					itemType: "Attachment",
					key: "PDF00001",
					parentItem: "BOOK0001",
					parentState: "published",
				},
				"https://library.example.org",
			),
		).toBe(
			"https://library.example.org/lib/BOOK0001/download/PDF00001",
		);
	});

	it.each([
		["no file", {}],
		["no parent", { filePublication: {}, parentItem: null }],
		["draft attachment", { filePublication: {}, state: "draft" as const }],
		[
			"draft parent",
			{ filePublication: {}, parentState: "draft" as const },
		],
	])("returns no link for an attachment with %s", (_, change) => {
		expect(
			buildAdminPublicItemUrl(
				{
					...baseItem,
					itemType: "Attachment",
					key: "PDF00001",
					parentItem: "BOOK0001",
					parentState: "published",
					...change,
				},
				"https://library.example.org",
			),
		).toBeNull();
	});
});
