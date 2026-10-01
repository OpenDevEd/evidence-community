import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getLibraryConfig = vi.hoisted(() => vi.fn());

vi.mock("@/config/library-config/server", () => ({
	getLibraryConfig,
}));

import {
	featureUnavailableResponse,
	getConfigForEnabledFeature,
} from "@/lib/runtime-feature";

describe("runtime feature route guard", () => {
	beforeEach(() => {
		getLibraryConfig.mockReset();
	});

	it("returns the active config only when the feature is enabled", async () => {
		const config = {
			features: {
				readerAccounts: true,
				aiSearch: false,
			},
		};
		getLibraryConfig.mockResolvedValue(config);

		await expect(
			getConfigForEnabledFeature("readerAccounts"),
		).resolves.toBe(config);
		await expect(
			getConfigForEnabledFeature("aiSearch"),
		).resolves.toBeNull();
	});

	it("returns a non-cacheable hidden-route response", async () => {
		const response = featureUnavailableResponse();

		expect(response.status).toBe(404);
		expect(response.headers.get("cache-control")).toBe(
			"no-store",
		);
		expect(await response.json()).toEqual({ error: "Not found" });
	});
});
