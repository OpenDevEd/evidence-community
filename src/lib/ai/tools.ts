import "server-only";

import { tool, type ModelMessage } from "ai";
import config from "@/constants/config.json";
import meilisearchClient from "@/lib/meilisearch";
import { hybridSearchOptions } from "@/lib/search-embedder";
import { meaningList, meaningPage, meaningSearchApplies, meaningSearchOptions } from "@/lib/meaning-search";
import {
	compileLibrarySearchRequest,
	type LibrarySearchParams,
} from "@/lib/search";
import { FULL_TEXT_PDF_FILTER } from "@/lib/search-filter-constants";
import type { LibrarySearchContext } from "@/lib/search-context";
import { zoteroMarkupToPlainText } from "@/lib/zoteroMarkup";
import { publicationToolModelOutput } from "./attachments";
import {
	createCurrentResultsCursor,
	currentResultsOffset,
	CURRENT_RESULTS_WINDOW_SIZE,
} from "./current-results-cursor";
import {
	createResearchToolSchemas,
	type ResearchMode,
	type SearchFilters,
	validateSearchFiltersAgainstUserRequest,
} from "./tool-schemas";

export type { ResearchMode } from "./tool-schemas";

const SEARCH_ATTRIBUTES = [
	"key",
	"title",
	"abstractNote",
	"itemType",
	"creators",
	"fullNames",
	"institution",
	"date",
	"datePublished",
	"year",
	"country",
	"publisher",
	"publicationTitle",
	"DOI",
	"url",
	"collections",
] as const;

const AI_SEARCH_LOG_PREFIX = "[ai:search]";

function logDevelopmentSearch(
	event: string,
	details: Record<string, unknown>,
) {
	if (process.env.NODE_ENV !== "development") return;

	console.info(
		AI_SEARCH_LOG_PREFIX,
		JSON.stringify({
			event,
			...details,
		}),
	);
}

function developmentError(error: unknown) {
	return error instanceof Error
		? { name: error.name, message: error.message, stack: error.stack }
		: { value: String(error) };
}

type SearchHit = Record<string, unknown>;

function searchHitToModelHit(hit: SearchHit) {
	return {
		key: String(hit.key),
		title: typeof hit.title === "string" ? hit.title : "Untitled",
		abstract:
			typeof hit.abstractNote === "string"
				? zoteroMarkupToPlainText(hit.abstractNote)
				: "",
		itemType: hit.itemType,
		creators: hit.creators,
		institution: hit.institution,
		date: hit.date,
		datePublished: hit.datePublished,
		year: hit.year,
		country: hit.country,
		publisher: hit.publisher,
		publicationTitle: hit.publicationTitle,
		DOI: hit.DOI,
		url: hit.url,
		citation: `/lib/${String(hit.key)}`,
	};
}

/**
 * Compact row for listing the current results in the user's order: enough
 * to identify each entry (and read it via readPublications) without the
 * abstract, so a full 200-entry window stays small.
 */
function searchHitToListEntry(hit: SearchHit, position: number) {
	const creators = Array.isArray(hit.creators)
		? hit.creators
				.map((creator) => {
					if (typeof creator === "string") return creator;
					if (!creator || typeof creator !== "object") return "";
					const { lastName, firstName, name } = creator as Record<
						string,
						unknown
					>;
					if (typeof name === "string") return name;
					return [lastName, firstName]
						.filter((part) => typeof part === "string" && part)
						.join(", ");
				})
				.filter(Boolean)
		: [];
	return {
		position,
		key: String(hit.key),
		title: typeof hit.title === "string" ? hit.title : "Untitled",
		creators: creators.slice(0, 3),
		moreCreators: Math.max(0, creators.length - 3),
		year: hit.year ?? hit.datePublished ?? hit.date,
		itemType: hit.itemType,
		citation: `/lib/${String(hit.key)}`,
	};
}

type SearchLogContext = {
	requestId: string;
	searchId: string;
	mode: ResearchMode;
};

function latestUserText(messages: ModelMessage[]) {
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "user") continue;
		if (typeof message.content === "string") {
			return message.content.replace(
				/<request_context>[\s\S]*?<\/request_context>/g,
				"",
			);
		}

		return message.content
			.filter((part) => part.type === "text")
			.map((part) => part.text)
			.join("\n")
			.replace(/<request_context>[\s\S]*?<\/request_context>/g, "");
	}

	return "";
}

function toolSearchParams(
	query: string,
	filters: SearchFilters | undefined,
): LibrarySearchParams {
	return {
		search: query,
		range: filters?.yearRange?.join("-") || "",
		country: filters?.country ?? [],
		institution: filters?.institution ?? [],
		collections: filters?.collection ?? [],
		sort: filters?.sort,
	};
}

async function searchOne(
	query: string,
	filters: SearchFilters | undefined,
	limit: number,
	allowedKeys?: string[],
	logContext?: SearchLogContext,
) {
	if (allowedKeys && allowedKeys.length === 0) {
		logDevelopmentSearch("query.skipped", {
			...logContext,
			query,
			reason: "current-results-window-empty",
		});
		return { query, hits: [], totalHits: 0 };
	}

	const compiled = compileLibrarySearchRequest(
		toolSearchParams(query, filters),
	);
	const finalFilters = [...compiled.finalFilters];
	if (filters?.fullTextOnly && !finalFilters.includes(FULL_TEXT_PDF_FILTER)) {
		finalFilters.push(FULL_TEXT_PDF_FILTER);
	}
	if (allowedKeys) {
		finalFilters.push(`key IN ${JSON.stringify(allowedKeys)}`);
	}

	const indexName = process.env.MEILI_INDEX || config.index;
	const searchOptions = {
		...(await hybridSearchOptions(indexName, query, 0.5)),
		filter: finalFilters,
		limit,
		attributesToSearchOn: compiled.attributesToSearchOn,
		attributesToRetrieve: [...SEARCH_ATTRIBUTES],
		...(compiled.sortOption ? { sort: [compiled.sortOption] } : {}),
	};
	const startedAt = Date.now();

	logDevelopmentSearch("query.started", {
		...logContext,
		query,
		indexName,
		filters,
		allowedKeyCount: allowedKeys?.length,
		searchOptions,
	});

	try {
		const result = await meilisearchClient
			.index(indexName)
			.search(query, searchOptions);
		const hits = result.hits.map(searchHitToModelHit);
		const totalHits = result.estimatedTotalHits ?? result.hits.length;

		logDevelopmentSearch("query.completed", {
			...logContext,
			query,
			durationMs: Date.now() - startedAt,
			returnedHits: hits.length,
			totalHits,
			keys: hits.map(({ key }) => key),
		});

		return { query, hits, totalHits };
	} catch (error) {
		logDevelopmentSearch("query.failed", {
			...logContext,
			query,
			durationMs: Date.now() - startedAt,
			error: developmentError(error),
		});
		throw error;
	}
}

type CurrentResultsWindow = {
	keys: string[];
	/** Window entries in the user's displayed order. */
	entries: ReturnType<typeof searchHitToListEntry>[];
	/** Meilisearch sort applied to the user's results (relevance when unset). */
	sort?: string;
	start: number;
	end: number;
	total: number;
	hasMore: boolean;
	nextCursor?: string;
};

type CurrentResultsWindowChoice = "first" | "last";

async function loadCurrentResultsWindow(
	searchContext: LibrarySearchContext,
	cursor: string | undefined,
	window: CurrentResultsWindowChoice,
): Promise<CurrentResultsWindow> {
	const index = meilisearchClient.index(process.env.MEILI_INDEX || config.index);
	const compiled = compileLibrarySearchRequest(searchContext);
	const baseOptions = {
		attributesToSearchOn: compiled.attributesToSearchOn,
		filter: compiled.finalFilters,
		...(compiled.sortOption ? { sort: [compiled.sortOption] } : {}),
	};
	// The reader's list adds results by meaning when they do: the AI reads that same list.
	const hybrid =
		!searchContext.wordsOnly && (await meaningSearchApplies(compiled.search, searchContext.scope))
			? await meaningSearchOptions(index.uid, compiled.search)
			: null;
	const list = hybrid
		? await meaningList(index, compiled.search, hybrid, compiled.attributesToSearchOn, compiled.finalFilters)
		: null;
	let offset = currentResultsOffset(searchContext, cursor);
	if (!cursor && window === "last") {
		// Exact total (page-based requests return totalHits, not an
		// estimate) so the final window starts at total - 200.
		const total =
			list?.keys.length ??
			(
				await index.search(compiled.search, {
					...baseOptions,
					hitsPerPage: 1,
					page: 1,
					attributesToRetrieve: ["key"],
				})
			).totalHits;
		offset = Math.max(0, total - CURRENT_RESULTS_WINDOW_SIZE);
	}
	const result = list
		? {
				hits: await meaningPage(index, list, {
					offset,
					limit: CURRENT_RESULTS_WINDOW_SIZE,
					sort: compiled.sortOption,
					attributesToRetrieve: [...SEARCH_ATTRIBUTES],
					filter: compiled.finalFilters,
				}),
				estimatedTotalHits: list.keys.length,
			}
		: await index.search(compiled.search, {
				...baseOptions,
				offset,
				limit: CURRENT_RESULTS_WINDOW_SIZE,
				attributesToRetrieve: [...SEARCH_ATTRIBUTES],
			});
	const hits = result.hits.filter(
		(hit) =>
			(typeof hit.key === "string" && hit.key) ||
			typeof hit.key === "number",
	);
	const keys = hits.map((hit) => String(hit.key));
	const entries = hits.map((hit, index) =>
		searchHitToListEntry(hit, offset + index + 1),
	);
	const total = result.estimatedTotalHits ?? keys.length;
	const end = offset + keys.length;
	const hasMore = end < total;

	return {
		keys,
		entries,
		sort: compiled.sortOption,
		start: keys.length > 0 ? offset + 1 : 0,
		end,
		total,
		hasMore,
		...(hasMore
			? {
					nextCursor: createCurrentResultsCursor(
						searchContext,
						offset + CURRENT_RESULTS_WINDOW_SIZE,
					),
				}
			: {}),
	};
}

export function createResearchTools(
	mode: ResearchMode,
	searchContext?: LibrarySearchContext,
	requestId = "unknown",
) {
	const schemas = createResearchToolSchemas(mode);
	let currentWindowId: string | undefined;
	let currentWindowPromise: Promise<CurrentResultsWindow> | undefined;

	const currentResultsWindow = (
		cursor: string | undefined,
		window: CurrentResultsWindowChoice,
	) => {
		if (!searchContext) {
			throw new Error(
				"There is no current library result set for this conversation.",
			);
		}

		const windowId = cursor ?? `window:${window}`;
		if (currentWindowPromise && currentWindowId !== windowId) {
			throw new Error(
				"Only one 200-publication result window can be inspected per user message. Ask the user to continue before using the next cursor.",
			);
		}

		if (!currentWindowPromise) {
			currentWindowId = windowId;
			currentWindowPromise = loadCurrentResultsWindow(
				searchContext,
				cursor,
				window,
			);
		}

		return currentWindowPromise;
	};
	return {
		searchLibrary: tool({
			description:
				"Search the Evidence Library for candidate publications. Submit related query variations together so they run in parallel. Results contain discovery metadata and abstracts, not page-verifiable evidence. Before relying on a publication's substantive claims, use readPublications and cite its exact PDF page. Use filters.fullTextOnly to return only publications with searchable PDF full text. When the request context says a current result set is available and the user refers to it, set withinCurrentResults=true: with no queries this lists one 200-entry window of those results in the user's own order (positions, keys, titles, creators, years) — use it for questions about the list itself such as counts, order, or the first/last/Nth entry (window='last' for the end of the list); with queries it searches only inside that window. At most one window per user message; to continue later, pass the nextCursor returned by the previous call.",
			inputSchema: schemas.searchLibrary,
			execute: async (
				{
					queries,
					withinCurrentResults,
					window,
					cursor,
					filters,
					limitPerQuery,
				},
				{ messages },
			) => {
				const searchId = crypto.randomUUID();
				// Strict-mode providers send every property; an empty cursor
				// means none.
				cursor = cursor || undefined;
				if (cursor && !withinCurrentResults) {
					throw new Error(
						"A current-results cursor requires withinCurrentResults=true.",
					);
				}
				const modeFilters =
					mode === "research" && filters?.fullTextOnly === undefined
						? { ...filters, fullTextOnly: true }
						: filters;
				const { effectiveFilters, ignoredFilters } =
					validateSearchFiltersAgainstUserRequest(
						modeFilters,
						latestUserText(messages),
					);
				const currentResults = withinCurrentResults
					? await currentResultsWindow(cursor, window)
					: undefined;
				const isListing = withinCurrentResults && queries.length === 0;

				logDevelopmentSearch("tool.called", {
					requestId,
					searchId,
					mode,
					queries,
					withinCurrentResults,
					window,
					isListing,
					cursor,
					requestedFilters: filters,
					effectiveFilters,
					ignoredFilters,
					limitPerQuery,
					currentResults: currentResults
						? {
								start: currentResults.start,
								end: currentResults.end,
								total: currentResults.total,
								keyCount: currentResults.keys.length,
							}
						: undefined,
				});

				return {
					appliedFilters: effectiveFilters,
					ignoredFilters,
					queries: await Promise.all(
						queries.map((query) =>
							searchOne(
								query,
								effectiveFilters,
								limitPerQuery,
								currentResults?.keys,
								{ requestId, searchId, mode },
							),
						),
					),
					...(currentResults
						? {
								currentResults: {
									start: currentResults.start,
									end: currentResults.end,
									total: currentResults.total,
									hasMore: currentResults.hasMore,
									nextCursor: currentResults.nextCursor,
									order: currentResults.sort
										? `sorted by ${currentResults.sort}`
										: "relevance order as displayed",
									// The window in the user's order; only
									// when listing, so searches stay compact.
									...(isListing
										? { entries: currentResults.entries }
										: {}),
								},
							}
						: {}),
				};
			},
		}),
		readPublications: tool({
			description:
				"Read the complete visible PDF attachments for selected Evidence Library publications. Use this before making evidence claims so every claim can identify both its publication source and exact PDF page. Use publication keys returned by searchLibrary and submit multiple keys together to read them in parallel. Prefer two or three of the most relevant publications per call: PDFs within about 20 MB per call are attached inline and cached across turns, anything beyond that is attached by reference and is slower to process.",
			inputSchema: schemas.readPublications,
			execute: async ({ itemKeys }) => ({
				requestedItemKeys: [...new Set(itemKeys)],
			}),
			toModelOutput: async ({ input }) =>
				publicationToolModelOutput([...new Set(input.itemKeys)]),
		}),
	};
}
