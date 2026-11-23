import { describe, expect, it } from "vitest";

import { docidOf, normalizeDocid } from "@/lib/docid";
import { reportZoteroItem } from "@/lib/openscholar-report";
import type { LiveOpenscholarReport } from "@/lib/openscholar-service";

describe("a record's DOCiD", () => {
	it("reads the DOCiD a record keeps in its Extra, among its other lines", () => {
		expect(docidOf({ extra: "Citation Key: phiri2026\nDOCiD: 20.500.14351/48177f" })).toBe("20.500.14351/48177f");
	});

	it("reads one given as its Handle address", () => {
		expect(docidOf({ url: "https://hdl.handle.net/20.500.14351/48177f" })).toBe("20.500.14351/48177f");
	});

	it("takes no other Handle prefix, and nothing that isn't a Handle", () => {
		expect(normalizeDocid("20.500.12345/abc")).toBeNull();
		expect(docidOf({ extra: "DOCiD: pending", url: "https://doi.org/10.53832/x" })).toBeNull();
	});

	it("keeps an Openscholar report's DOCiD as its record's Extra line", () => {
		const report = { state: "live", key: "R100700", doi: "10.53832/openscholar-reports.r100700", docid: "20.500.14351/48177f", version: "2026-11-23T00:00:00.000Z", title: "Cash transfers", subtitle: "", type: "report", language: "en", date: "2026", licence: "CC BY 4.0", abstract: "", authors: [], keywords: [], topics: [], series: "Openscholar Reports", pageUrl: "https://discover.openscholar.ai/papers/R100700", pdfUrl: null } satisfies LiveOpenscholarReport;
		expect(docidOf(reportZoteroItem(report) as { extra?: string })).toBe("20.500.14351/48177f");
		expect(reportZoteroItem({ ...report, docid: undefined })).not.toHaveProperty("extra");
	});
});
