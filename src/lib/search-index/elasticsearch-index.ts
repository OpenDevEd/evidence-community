import { createHash } from "node:crypto";

import { INSTITUTION_FILTER_FIELD } from "@/config/library-config/institutions";
import { PDF_PRESENCE_ATTRIBUTE, SOURCES_FIELD } from "@/lib/search-filter-constants";

/**
 * The Elasticsearch index a library's records are searched in (OpenDevEd/new-el#719). Fields readers filter, count,
 * or sort on are kept whole as keywords; the ones they also search get an analysed `.text` field. Every other text
 * field is analysed with the ICU tokenizer, so text without spaces between words splits into words.
 *
 * Elasticsearch can't change an existing field's mapping in place. The definition's version is saved in the index,
 * and a worker that finds another version rebuilds into a new index and moves the library's alias to it.
 */

const KEYWORD_FIELDS = [
	"key",
	"itemType",
	"studyType",
	"studyTypeShown",
	INSTITUTION_FILTER_FIELD,
	"country",
	"authorCountry",
	"collections",
	"collectionsAncestry",
	"topicAncestors",
	"provider",
	"sourceConnectionKey",
	SOURCES_FIELD,
];

const SEARCHED_KEYWORD_FIELDS = ["tags", "fullNames"];

const text = { type: "text", analyzer: "library_text" } as const;

function definition() {
	return {
		settings: {
			index: {
				number_of_shards: 1,
				// One node: a replica would never be placed.
				number_of_replicas: 0,
				"mapping.total_fields.limit": 10_000,
				// A field that holds a number in one record and text in another keeps the rest of the record.
				"mapping.ignore_malformed": true,
			},
			analysis: {
				analyzer: { library_text: { type: "custom", tokenizer: "icu_tokenizer", filter: ["icu_folding"] } },
				normalizer: { sort_key: { type: "custom", filter: ["lowercase", "asciifolding"] } },
			},
		},
		mappings: {
			date_detection: false,
			numeric_detection: false,
			dynamic_templates: [{ strings: { match_mapping_type: "string", mapping: text } }],
			properties: {
				...Object.fromEntries(KEYWORD_FIELDS.map((field) => [field, { type: "keyword" }])),
				...Object.fromEntries(
					SEARCHED_KEYWORD_FIELDS.map((field) => [field, { type: "keyword", normalizer: "sort_key", fields: { text } }]),
				),
				title: { ...text, fields: { sort: { type: "keyword", normalizer: "sort_key", ignore_above: 512 } } },
				deleted: { type: "integer" },
				year: { type: "integer" },
				citationCount: { type: "long" },
				dateSortKey: { type: "double" },
				dateAdded: { type: "keyword" },
				updatedAt: { type: "keyword" },
				[PDF_PRESENCE_ATTRIBUTE]: { type: "boolean" },
			},
		},
	};
}

/** The version a library's live index must carry, else the worker rebuilds it. */
export const SEARCH_INDEX_VERSION = createHash("sha256").update(JSON.stringify(definition())).digest("hex").slice(0, 16);

/** The body that creates one of a library's indexes, with its version saved in the mapping. */
export function searchIndexDefinition() {
	const { settings, mappings } = definition();
	return { settings, mappings: { ...mappings, _meta: { version: SEARCH_INDEX_VERSION } } };
}

/** A new index behind the library's alias. Its login reaches only `<alias>_*`. */
export function newSearchIndexName(alias: string, now = Date.now()) {
	return `${alias}_${now}`;
}
