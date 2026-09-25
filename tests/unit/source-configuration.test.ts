import { describe, expect, it } from "vitest";

import { libraryConfigSchema } from "@/config/library-config/schema";
import { configuredSourceConnectionValues } from "@/lib/source-ingestion/configuration";
import { openAlexQuerySchema } from "@/lib/source-ingestion/openalex/schema";
import { maximalLibraryConfig } from "../fixtures/library-config";

describe("manifest-owned source configuration", () => {
	it("keeps OpenAlex queries independent and PDF processing off unless enabled per source", () => {
		const source = {
			key: "openalex-education", provider: "openalex", apiKey: "api-key",
			settings: { name: "AI in education", searchUrl: "/results/saved-search-1?q=education&focus=KE&review=true", approvedQuery: { version: "approved-1", approvedAt: "2026-09-24T10:00:00Z", query: { search: "AI in education" } } },
		};
		const config = libraryConfigSchema.parse({ ...maximalLibraryConfig, sources: [source, { ...source, key: "openalex-kenya", settings: { ...source.settings, downloadPdfs: true } }] });
		expect(configuredSourceConnectionValues(config.sources[0])).toMatchObject({
			provider: "openalex", scopeKind: "query", externalScopeKey: null,
			config: { ...source.settings, downloadPdfs: false, apiKeyMode: "platform" },
		});
		expect(config.sources[1].settings).toHaveProperty("downloadPdfs", true);
		expect(configuredSourceConnectionValues(config.sources[0])).not.toHaveProperty("apiKey");
		expect(libraryConfigSchema.safeParse({ ...maximalLibraryConfig, sources: [{ ...source, writebackEnabled: true }] }).success).toBe(false);
	});
	it("rejects an OpenAlex query whose only filter is the default retraction filter", () => {
		expect(openAlexQuerySchema.safeParse({ filter: "is_retracted:false" }).success).toBe(false);
		expect(openAlexQuerySchema.safeParse({ filter: "is_retracted:false,publication_year:2024" }).success).toBe(true);
	});
	it("maps a Zotero source without copying its API key into database state", () => {
		const config = libraryConfigSchema.parse(maximalLibraryConfig);
		const values = configuredSourceConnectionValues(config.sources[0]);

		expect(values).toEqual({
			key: "zotero-maximal",
			provider: "zotero",
			scopeKind: "group",
			externalScopeKey: "6632364",
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
			}>;
		};
		input.sources[0].enabled = false;
		const config = libraryConfigSchema.parse(input);

		expect(configuredSourceConnectionValues(config.sources[0]).status).toBe(
			"paused",
		);
	});
});
