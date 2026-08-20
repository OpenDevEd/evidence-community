import { describe, expect, it } from "vitest";

import {
	formatZoteroItemUri,
	parseZoteroItemUri,
} from "@/lib/source-ingestion/zotero/uri";

describe("parseZoteroItemUri", () => {
	it("reads a group item URI", () => {
		expect(
			parseZoteroItemUri("http://zotero.org/groups/6632364/items/ABCD2345"),
		).toEqual({ libraryType: "group", libraryId: "6632364", itemKey: "ABCD2345" });
	});

	it("reads a user item URI over https and with a trailing slash", () => {
		expect(
			parseZoteroItemUri("https://www.zotero.org/users/12345/items/QWER5678/"),
		).toEqual({ libraryType: "user", libraryId: "12345", itemKey: "QWER5678" });
	});

	it("returns null for collections, non-Zotero URLs, bad keys, and junk", () => {
		expect(
			parseZoteroItemUri("http://zotero.org/groups/6632364/collections/ABCD2345"),
		).toBeNull();
		expect(parseZoteroItemUri("https://example.org/items/ABCD2345")).toBeNull();
		expect(parseZoteroItemUri("http://zotero.org/groups/1/items/abcd2345")).toBeNull();
		expect(parseZoteroItemUri("http://zotero.org/groups/1/items/TOOSHORT1")).toBeNull();
		expect(parseZoteroItemUri("")).toBeNull();
		expect(parseZoteroItemUri("not a url")).toBeNull();
	});
});

describe("formatZoteroItemUri", () => {
	it("builds the canonical http URI for groups and users", () => {
		expect(
			formatZoteroItemUri({ libraryType: "group", libraryId: "6632364", itemKey: "ABCD2345" }),
		).toBe("http://zotero.org/groups/6632364/items/ABCD2345");
		expect(
			formatZoteroItemUri({ libraryType: "user", libraryId: "9", itemKey: "ABCD2345" }),
		).toBe("http://zotero.org/users/9/items/ABCD2345");
	});

	it("round-trips through the parser", () => {
		const reference = { libraryType: "group" as const, libraryId: "42", itemKey: "ZXCV9876" };
		expect(parseZoteroItemUri(formatZoteroItemUri(reference))).toEqual(reference);
	});
});
