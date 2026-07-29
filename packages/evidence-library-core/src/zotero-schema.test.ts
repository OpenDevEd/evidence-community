import { describe, expect, it } from "vitest";

import {
	getZoteroItemType,
	getZoteroItemTypes,
	getZoteroSchema,
} from "./zotero-schema.js";

describe("vendored Zotero schema", () => {
	it("loads the pinned schema without network access", () => {
		expect(getZoteroSchema().version).toBe(44);
		expect(getZoteroItemTypes().size).toBe(40);
	});

	it("exposes the fields and creator types for each item type", () => {
		const book = getZoteroItemType("book");

		expect(book?.fields.map(({ field }) => field)).toContain("title");
		expect(
			book?.creatorTypes.map(({ creatorType }) => creatorType),
		).toContain("author");
		expect(getZoteroItemType("not-a-real-type")).toBeNull();
	});
});
