import { MeilisearchApiError, type Embedders, type OpenAiEmbedder, type RestEmbedder } from "meilisearch";

import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import type { LibraryServerConfig } from "@/config/library-config/schema";

export type SearchEmbedderConfiguration =
	LibraryServerConfig["search"]["embedder"];

// Meilisearch reports a missing embedder with the first code and a failing
// embedding provider with the second. Both mean "not ready", not a bug.
const EMBEDDER_NOT_READY_CODES = new Set([
	"invalid_search_embedder",
	"vector_embedding_error",
]);

/** The search needed the embedder, which is missing or failing, as while the search worker still sets it up. */
export function isEmbedderUnavailable(error: unknown) {
	return (
		error instanceof MeilisearchApiError &&
		Boolean(
			error.cause?.code && EMBEDDER_NOT_READY_CODES.has(error.cause.code),
		)
	);
}

/** Adding or changing an embedder makes Meilisearch re-embed every record. */
export const EMBEDDER_TASK_TIMEOUT_MS = 60 * 60 * 1_000;
/** A re-embed can run for a long time; ask Meilisearch about it every 2 s. */
export const EMBEDDER_TASK_POLL_INTERVAL_MS = 2_000;

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

/** Liquid's `if`: only a missing value, null and false are false; empty text and empty lists are true. */
function present(value: unknown) {
	return value !== undefined && value !== null && value !== false;
}

function printed(value: unknown): string {
	if (Array.isArray(value)) return value.map(printed).join("");
	return value === undefined || value === null ? "" : String(value);
}

function joined(value: unknown) {
	return Array.isArray(value) ? value.map(printed).join(", ") : printed(value);
}

/** The text cut to `maxBytes` of UTF-8, at a whole character. */
function cutToBytes(text: string, maxBytes: number) {
	if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
	let bytes = 0;
	let end = 0;
	for (const character of text) {
		bytes += Buffer.byteLength(character, "utf8");
		if (bytes > maxBytes) break;
		end += character.length;
	}
	return text.slice(0, end);
}

/**
 * The text embedded for a record in Elasticsearch: `PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE` rendered as Meilisearch's
 * Liquid renders it, cut to the same byte limit (OpenDevEd/new-el#720).
 */
export function embeddingText(document: Record<string, unknown>) {
	const { title, abstractNote, fullNames, tags, year } = document;
	const text = [
		`A research record${present(title) ? ` titled '${printed(title)}'` : ""}.`,
		present(abstractNote) ? `Abstract: ${printed(abstractNote)}.` : "",
		present(fullNames) ? `Authors: ${joined(fullNames)}.` : "",
		present(tags) ? `Keywords: ${joined(tags)}.` : "",
		present(year) ? `Published in ${printed(year)}.` : "",
	].join(" ");
	return cutToBytes(text, PLATFORM_EMBEDDER_DOCUMENT_TEMPLATE_MAX_BYTES);
}

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
