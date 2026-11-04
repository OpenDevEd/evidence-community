import { describe, expect, it } from "vitest";

import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import {
	buildEmbedderSettings,
	embeddingText,
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

	it("guards every field so a record with no title still renders", () => {
		// Meilisearch fails the whole embedding task when the template reads
		// a field the document does not have. Every field must sit inside an
		// `{% if doc.<field> %}` guard.
		const reads = [
			...PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE.matchAll(/{{\s*doc\.(\w+)/g),
		].map((match) => match[1]);
		expect(reads.length).toBeGreaterThan(0);
		for (const field of reads) {
			expect(PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE).toContain(
				`{% if doc.${field} %}`,
			);
		}
	});
});

describe("the text embedded for a record in Elasticsearch", () => {
	// Each expected text is what Meilisearch 1.54.3 rendered from the platform template for the same record, through its
	// experimental render route: Liquid prints empty text and empty lists, and skips only missing, null and false values.
	it.each([
		[
			"every field",
			{ title: "Mobile phones and literacy", abstractNote: "We study SMS lessons.", fullNames: ["Amina Okafor", "Li Wei"], tags: ["literacy", "mobile learning"], year: "2021" },
			"A research record titled 'Mobile phones and literacy'. Abstract: We study SMS lessons.. Authors: Amina Okafor, Li Wei. Keywords: literacy, mobile learning. Published in 2021.",
		],
		["no field", { key: "X" }, "A research record.    "],
		["empty values", { title: "", abstractNote: null, fullNames: [], tags: [], year: 0 }, "A research record titled ''.  Authors: . Keywords: . Published in 0."],
		["false and empty text", { title: false, abstractNote: "", tags: ["a"], year: 2020 }, "A research record. Abstract: .  Keywords: a. Published in 2020."],
	])("renders a record with %s as Meilisearch does", (_name, record, text) => {
		expect(embeddingText(record)).toBe(text);
	});

	it("cuts a long text to the byte limit at a whole character", () => {
		const text = embeddingText({ abstractNote: "é".repeat(PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE_MAX_BYTES) });
		expect(Buffer.byteLength(text, "utf8")).toBeLessThanOrEqual(PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE_MAX_BYTES);
		expect(Buffer.byteLength(text, "utf8")).toBeGreaterThan(PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE_MAX_BYTES - 2);
		expect(text).not.toContain("\uFFFD");
		expect(text.endsWith("é")).toBe(true);
	});
});
