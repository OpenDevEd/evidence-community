import type { Embedders, OpenAiEmbedder, RestEmbedder } from "meilisearch";

import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export type SearchEmbedderConfiguration =
	LibraryServerConfig["search"]["embedder"];

/**
 * Embedder name that older indexes used. It is always removed so a library
 * never keeps two embedders for the same records.
 */
const LEGACY_EMBEDDER_NAME = "openai";

/**
 * Meilisearch truncates the rendered template to 400 bytes by default. That
 * cuts most abstracts in half, so every embedder sends this larger limit.
 */
export const PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE_MAX_BYTES = 8000;

/**
 * Text that Meilisearch embeds for every published record. It reads the
 * projected search document (see `projection.ts`): title, abstract, creator
 * names, tags, and year. Libraries cannot change it.
 */
// Every field sits inside an `if` guard. Meilisearch fails the whole
// embedding task when a template reads a field that a document does not have,
// and records such as an untitled ComputerProgram carry no `title`.
export const PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE = [
	"A research record{% if doc.title %} titled '{{doc.title}}'{% endif %}.",
	"{% if doc.abstractNote %}Abstract: {{doc.abstractNote}}.{% endif %}",
	"{% if doc.fullNames %}Authors: {{doc.fullNames | join: ', '}}.{% endif %}",
	"{% if doc.tags %}Keywords: {{doc.tags | join: ', '}}.{% endif %}",
	"{% if doc.year %}Published in {{doc.year}}.{% endif %}",
].join(" ");

function withoutUndefined<T extends object>(value: T): T {
	return Object.fromEntries(
		Object.entries(value).filter(([, entry]) => entry !== undefined),
	) as T;
}

/**
 * Builds the exact `embedders` setting for `index.updateSettings`.
 * `null` removes the platform embedder and drops its vectors.
 */
export function buildEmbedderSettings(
	embedder: SearchEmbedderConfiguration,
): NonNullable<Embedders> {
	if (embedder === null) {
		return {
			[PLATFORM_SEARCH_EMBEDDER]: null,
			[LEGACY_EMBEDDER_NAME]: null,
		};
	}
	const shared = {
		documentTemplate: PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE,
		documentTemplateMaxBytes: PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE_MAX_BYTES,
	};
	if (embedder.source === "openAi") {
		return {
			[PLATFORM_SEARCH_EMBEDDER]: withoutUndefined<OpenAiEmbedder>({
				source: "openAi",
				model: embedder.model,
				apiKey: embedder.apiKey,
				dimensions: embedder.dimensions,
				...shared,
			}),
			[LEGACY_EMBEDDER_NAME]: null,
		};
	}
	return {
		[PLATFORM_SEARCH_EMBEDDER]: withoutUndefined<RestEmbedder>({
			source: "rest",
			url: embedder.url,
			apiKey: embedder.apiKey,
			dimensions: embedder.dimensions,
			request: embedder.request,
			response: embedder.response,
			headers: embedder.headers,
			...shared,
		}),
		[LEGACY_EMBEDDER_NAME]: null,
	};
}
