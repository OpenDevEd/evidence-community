import { describe, expect, it } from "vitest";
import { openScholarList } from "@/lib/links/openscholar-lists";

const metric = { citedByCount: 7, referencedWorksCount: 131 };

describe("a record's lists in OpenScholar", () => {
	it("opens what an OpenAlex work cites and what cites it, with OpenAlex's totals", () => {
		const work = { sourceRecordKey: "W4412345678", citationMetrics: [metric] };
		// OpenScholar's filters name the direction from the listed works' side: the references are the works cited by this one.
		expect(openScholarList(work, "references")).toEqual({ total: 131, path: "/results?citedBy=W4412345678" });
		expect(openScholarList(work, "citations")).toEqual({ total: 7, path: "/results?cites=W4412345678" });
	});

	it("opens the lists of a record matched to OpenAlex from another source, by the work its totals are for", () => {
		const other = { citedByCount: 2, referencedWorksCount: 9, workId: null };
		const zotero = { sourceRecordKey: "ABCD2345", citationMetrics: [other, { ...metric, workId: "W900000004" }] };
		expect(openScholarList(zotero, "references")).toEqual({ total: 131, path: "/results?citedBy=W900000004" });
		expect(openScholarList(zotero, "citations")).toEqual({ total: 7, path: "/results?cites=W900000004" });
	});

	it("still opens the list when the library holds no totals for the work", () => {
		expect(openScholarList({ sourceRecordKey: "W1" }, "references")).toEqual({ total: null, path: "/results?citedBy=W1" });
	});

	it("has nothing for a record that is not an OpenAlex work, or when no list is asked for", () => {
		expect(openScholarList({ sourceRecordKey: "ABCD2345", citationMetrics: [metric] }, "references")).toBeNull();
		expect(openScholarList({ sourceRecordKey: null }, "citations")).toBeNull();
		expect(openScholarList(undefined, "citations")).toBeNull();
		expect(openScholarList({ sourceRecordKey: "W1" }, undefined)).toBeNull();
	});
});
