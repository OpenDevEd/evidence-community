import { describe, expect, it } from "vitest";

import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import {
	buildEmbedderSettings,
	PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE,
	PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE_MAX_BYTES,
} from "@/lib/search-index/embedder-settings";

describe("search index embedder settings", () => {
	it("removes our embedder and the legacy name when the library has none", () => {
		expect(buildEmbedderSettings(null)).toEqual({
			[PLATFORM_SEARCH_EMBEDDER]: null,
			openai: null,
		});
	});

	it("builds the openAi embedder with the platform template", () => {
		expect(
			buildEmbedderSettings({
				source: "openAi",
				model: "text-embedding-3-small",
				apiKey: "embedding-key",
				dimensions: 1536,
			}),
		).toEqual({
			[PLATFORM_SEARCH_EMBEDDER]: {
				source: "openAi",
				model: "text-embedding-3-small",
				apiKey: "embedding-key",
				dimensions: 1536,
				documentTemplate: PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE,
				documentTemplateMaxBytes: 8000,
			},
			openai: null,
		});
	});

	it("builds the rest embedder with the platform template", () => {
		expect(
			buildEmbedderSettings({
				source: "rest",
				url: "http://embedder.internal:8080/embed",
				apiKey: "rest-key",
				dimensions: 8,
				request: { input: "{{text}}" },
				response: { embedding: "{{embedding}}" },
				headers: { "X-Library": "test" },
			}),
		).toEqual({
			[PLATFORM_SEARCH_EMBEDDER]: {
				source: "rest",
				url: "http://embedder.internal:8080/embed",
				apiKey: "rest-key",
				dimensions: 8,
				request: { input: "{{text}}" },
				response: { embedding: "{{embedding}}" },
				headers: { "X-Library": "test" },
				documentTemplate: PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE,
				documentTemplateMaxBytes: 8000,
			},
			openai: null,
		});
	});

	it("leaves optional fields out instead of sending undefined", () => {
		const settings = buildEmbedderSettings({
			source: "openAi",
			model: "text-embedding-3-small",
			apiKey: "embedding-key",
		});
		expect(
			Object.keys(settings[PLATFORM_SEARCH_EMBEDDER] as object),
		).not.toContain("dimensions");
	});

	it("uses a template that reads the projected record fields", () => {
		expect(PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE_MAX_BYTES).toBe(8000);
		for (const field of [
			"title",
			"abstractNote",
			"fullNames",
			"tags",
			"year",
		]) {
			expect(PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE).toContain(
				`doc.${field}`,
			);
		}
	});
});
