import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ enabled: true, showUrl: false, title: "Schools in Kenya", fail: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/i18n/server", () => ({ getRuntimeRequestLocale: async () => "en-GB" }));
vi.mock("@/config/library-config/server", () => ({ getLibraryConfig: async () => ({
	citations: { enabled: state.enabled, showUrl: state.showUrl }, identity: { baseUrl: "https://library.example.org" },
}) }));
vi.mock("@/db", () => ({ getDatabaseForConfig: async () => ({}) }));
vi.mock("@/lib/public-item-card", () => ({ getPublicItemCards: async () => {
	if (state.fail) throw new Error("Database unavailable");
	return [{ key: "REPORT01", itemType: "Report", title: state.title, date: "2025",
		creators: [{ name: "UNICEF", creatorType: "author" }] }];
} }));

import { GET } from "@/app/api/item/[key]/citation/route";
import { NextRequest } from "next/server";

const request = () => GET(new NextRequest("https://library.example.org/api/item/REPORT01/citation"), { params: Promise.resolve({ key: "REPORT01" }) });
beforeEach(() => Object.assign(state, { enabled: true, showUrl: false, title: "Schools in Kenya", fail: false }));

describe("runtime citation route", () => {
	it("formats the current published metadata without a translation server and does not cache old record text", async () => {
		const first = await request();
		expect((await first.json()).citations.apa).toBe("UNICEF. (2025). Schools in Kenya.");
		state.title = "Updated school evidence";
		const updated = await request();
		expect((await updated.json()).citations.apa).toBe("UNICEF. (2025). Updated school evidence.");
		expect(updated.headers.get("cache-control")).toBe("no-store");
		expect(updated.headers.get("vary")).toBe("Accept-Language");
	});
	it("honors the citation visibility setting", async () => {
		state.enabled = false;
		expect(await (await request()).json()).toEqual({ citations: null, record: null });
	});
	it("includes the configured public URL in both citations and BibTeX when requested", async () => {
		state.showUrl = true;
		const { citations } = await (await request()).json();
		expect(citations.apa).toContain("Available at https://library.example.org/lib/REPORT01.");
		expect(citations.bibtex).toContain("url = {https://library.example.org/lib/REPORT01}");
	});
	it("returns no citation when the record has no title", async () => {
		state.title = "";
		expect(await (await request()).json()).toEqual({ citations: null, record: null });
	});
	it("returns a retryable uncached error on a data outage", async () => {
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		try {
			state.fail = true;
			const response = await request();
			expect(response.status).toBe(503);
			expect(response.headers.get("cache-control")).toBe("no-store");
		} finally { log.mockRestore(); }
	});
});
