import { describe, expect, it } from "vitest";

import {
	relatedLinkUris,
	relationsForWriteback,
} from "@/lib/source-writeback/related-links";

const group = { externalScopeKey: "6632364", scopeKind: "group" } as const;

describe("relatedLinkUris", () => {
	it("turns outgoing rows and incoming manual rows into Zotero item URIs", () => {
		const uris = relatedLinkUris({
			connection: group,
			itemKey: "AAAA2345",
			remoteKeys: new Map([
				["BBBB2345", "ZOTB2345"],
				["CCCC2345", "ZOTC2345"],
				["DDDD2345", "ZOTD2345"],
			]),
			rows: [
				{ fromKey: "AAAA2345", kind: "related", origin: "manual", toKey: "BBBB2345" },
				{ fromKey: "AAAA2345", kind: "related", origin: "source:zotero", toKey: "CCCC2345" },
				{ fromKey: "DDDD2345", kind: "related", origin: "manual", toKey: "AAAA2345" },
				{ fromKey: "EEEE2345", kind: "related", origin: "source:zotero", toKey: "AAAA2345" },
				{ fromKey: "AAAA2345", kind: "cites", origin: "manual", toKey: "BBBB2345" },
			],
		});
		expect(uris).toEqual([
			"http://zotero.org/groups/6632364/items/ZOTB2345",
			"http://zotero.org/groups/6632364/items/ZOTC2345",
			"http://zotero.org/groups/6632364/items/ZOTD2345",
		]);
	});

	it("skips targets that are not linked to this source and de-duplicates", () => {
		const uris = relatedLinkUris({
			connection: { externalScopeKey: "77", scopeKind: "personal-library" },
			itemKey: "AAAA2345",
			remoteKeys: new Map([["BBBB2345", "ZOTB2345"]]),
			rows: [
				{ fromKey: "AAAA2345", kind: "related", origin: "manual", toKey: "BBBB2345" },
				{ fromKey: "BBBB2345", kind: "related", origin: "manual", toKey: "AAAA2345" },
				{ fromKey: "AAAA2345", kind: "related", origin: "manual", toKey: "NOTLNK23" },
			],
		});
		expect(uris).toEqual(["http://zotero.org/users/77/items/ZOTB2345"]);
	});
});

describe("relationsForWriteback", () => {
	it("keeps other Zotero predicates, replaces dc:relation, and omits it when empty", () => {
		expect(
			relationsForWriteback(
				{
					"dc:relation": "http://zotero.org/groups/1/items/STALE234",
					"owl:sameAs": "http://zotero.org/groups/1/items/SAME2345",
					cited_by: 3,
				},
				["http://zotero.org/groups/1/items/NEWW2345"],
			),
		).toEqual({
			"dc:relation": "http://zotero.org/groups/1/items/NEWW2345",
			"owl:sameAs": "http://zotero.org/groups/1/items/SAME2345",
			cited_by: 3,
		});
		expect(
			relationsForWriteback({ "dc:relation": ["a", "b"] }, [
				"http://zotero.org/groups/1/items/AAAA2345",
				"http://zotero.org/groups/1/items/BBBB2345",
			]),
		).toEqual({
			"dc:relation": [
				"http://zotero.org/groups/1/items/AAAA2345",
				"http://zotero.org/groups/1/items/BBBB2345",
			],
		});
		expect(relationsForWriteback({ "dc:relation": "x" }, [])).toEqual({});
		expect(relationsForWriteback(null, [])).toEqual({});
	});
});
