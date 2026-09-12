import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/i18n/server", () => ({
	getRuntimeRequestLocale: vi.fn().mockResolvedValue("en-GB"),
}));
vi.mock("@/lib/citations", () => ({
	getCitationForItemKey: vi.fn(),
}));

import { GET } from "@/app/api/item/[key]/citation/route";
import { getCitationForItemKey } from "@/lib/citations";
import { ZoteroTranslationError } from "@/lib/zotero-translation";

const mockedGetCitationForItemKey = vi.mocked(
	getCitationForItemKey,
);

beforeEach(() => {
	mockedGetCitationForItemKey.mockResolvedValue(
		'<div class="csl-entry">A citation.</div>',
	);
});

describe("runtime citation route", () => {
	it("does not serve an older public citation after the record changes", async () => {
		const response = await GET(
			new Request(
				"https://library.example.org/api/item/ITEM01/citation",
			) as never,
			{ params: Promise.resolve({ key: "ITEM01" }) },
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			citation: '<div class="csl-entry">A citation.</div>',
		});
		expect(response.headers.get("cache-control")).toBe("no-store");
	});

	it("does not cache a transient translation outage", async () => {
		const warning = vi
			.spyOn(console, "warn")
			.mockImplementation(() => undefined);
		mockedGetCitationForItemKey.mockRejectedValue(
			new ZoteroTranslationError(
				"Translation unavailable",
				{
					code: "TRANSLATION_REQUEST_FAILED",
					status: 503,
				},
			),
		);

		const response = await GET(
			new Request(
				"https://library.example.org/api/item/ITEM01/citation",
			) as never,
			{ params: Promise.resolve({ key: "ITEM01" }) },
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ citation: null });
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(warning).toHaveBeenCalledOnce();
	});
});
