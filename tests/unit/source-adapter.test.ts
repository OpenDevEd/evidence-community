import { describe, expect, it } from "vitest";

import {
	parseSourceSyncResult,
	SourceAdapterNotFoundError,
	SourceAdapterRegistrationError,
	SourceAdapterRegistry,
	type SourceAdapter,
} from "@/lib/source-ingestion/adapter";

function adapter(
	provider: SourceAdapter["provider"],
): SourceAdapter {
	return {
		provider,
		sync: async () => ({ provider }),
	};
}

describe("SourceAdapterRegistry", () => {
	it("dispatches registered adapters and exposes a stable provider list", () => {
		const zotero = adapter("zotero");
		const registry = new SourceAdapterRegistry([
			zotero,
			adapter("openalex"),
		]);

		expect(registry.get("zotero")).toBe(zotero);
		expect(registry.providers()).toEqual(["openalex", "zotero"]);
	});

	it("rejects duplicate provider registrations", () => {
		expect(
			() =>
				new SourceAdapterRegistry([
					adapter("mendeley"),
					adapter("mendeley"),
				]),
		).toThrow(SourceAdapterRegistrationError);
	});

	it("rejects unregistered providers", () => {
		expect(() =>
			new SourceAdapterRegistry().get("dspace"),
		).toThrow(SourceAdapterNotFoundError);
	});
});

describe("parseSourceSyncResult", () => {
	it("accepts bounded JSON objects", () => {
		expect(
			parseSourceSyncResult({
				deleted: 2,
				nextCursor: { page: 3 },
				provider: "openalex",
			}),
		).toEqual({
			deleted: 2,
			nextCursor: { page: 3 },
			provider: "openalex",
		});
	});

	it("rejects non-JSON values", () => {
		expect(() =>
			parseSourceSyncResult({ count: BigInt(1) }),
		).toThrow();
	});

	it("rejects results larger than one MiB", () => {
		expect(() =>
			parseSourceSyncResult({
				value: "x".repeat(1024 * 1024),
			}),
		).toThrow(/exceeds 1 MiB/);
	});
});
