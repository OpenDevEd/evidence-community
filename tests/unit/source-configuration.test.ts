import { describe, expect, it } from "vitest";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { configuredSourceConnectionValues } from "@/lib/source-ingestion/configuration";
import { maximalLibraryConfig } from "../fixtures/library-config";

describe("manifest-owned source configuration", () => {
	it("maps a Zotero source without copying its API key into database state", () => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		const values = configuredSourceConnectionValues(config.sources[0]);

		expect(values).toEqual({
			key: "zotero-maximal",
			provider: "zotero",
			scopeKind: "group",
			externalScopeKey: "6632364",
			defaultWriteback: true,
			config: config.sources[0].settings,
			status: "active",
		});
		expect(values).not.toHaveProperty("apiKey");
		expect(values).not.toHaveProperty("credentialRef");
	});

	it("maps disabled sources to paused durable state", () => {
		const input = structuredClone(maximalLibraryConfig) as {
			sources: Array<{
				enabled: boolean;
				defaultWriteback: boolean;
			}>;
		};
		input.sources[0].enabled = false;
		input.sources[0].defaultWriteback = false;
		const config = libraryConfigSchema.parse(input);

		expect(configuredSourceConnectionValues(config.sources[0]).status).toBe(
			"paused",
		);
	});
});
