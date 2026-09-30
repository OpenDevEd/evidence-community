import "server-only";

import { tool, type ModelMessage } from "ai";

import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { abstractPlainText } from "@/lib/abstract-text";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { resolveSearchRequest, resolveSearchTopicNodes } from "@/lib/search";
import type { LibrarySearchContext } from "@/lib/search-context";
import { PDF_FILTER, PDF_PRESENCE_ATTRIBUTE } from "@/lib/search-filter-constants";
import { publicationToolModelOutput } from "./attachments";
import {
	CURRENT_RESULTS_WINDOW_SIZE,
	createCurrentResultsCursor,
	currentResultsOffset,
} from "./current-results-cursor";
import {
	createResearchToolSchemas,
	validateSearchFiltersAgainstUserRequest,
	type ResearchMode,
	type SearchFilters,
} from "./tool-schemas";

export type { ResearchMode } from "./tool-schemas";

type SearchConfig = Pick<
	LibraryServerConfig,
	"authentication" | "content" | "filters" | "revision" | "search" | "services" | "topics" | "updatedAt"
>;

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
	PDF_PRESENCE_ATTRIBUTE,
] as const;

function logDevelopmentSearch(
	event: string,
	details: Record<string, unknown>,
) {
	if (process.env.NODE_ENV !== "development") return;
	console.info("[ai:search]", JSON.stringify({ event, ...details }));
}

function developmentError(error: unknown) {
	return error instanceof Error
		? { name: error.name, message: error.message }
		: { value: String(error) };
}

type SearchHit = Record<string, unknown>;

function searchHitToModelHit(hit: SearchHit) {
	return {
		key: String(hit.key),
		title: typeof hit.title === "string" ? hit.title : "Untitled",
		abstract: abstractPlainText(hit.abstractNote),
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
		hasPdf: hit[PDF_PRESENCE_ATTRIBUTE] === true,
		citation: `/lib/${String(hit.key)}`,
	};
}

function hitCreatorNames(hit: SearchHit) {
	if (!Array.isArray(hit.creators)) return [] as string[];

	return hit.creators
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
		.filter(Boolean) as string[];
}

/**
 * Compact row for listing the current results in the reader's own order:
 * enough to identify each entry without its abstract, so a full 200-entry
 * window stays small.
 */
function searchHitToListEntry(hit: SearchHit, position: number) {
	const creators = hitCreatorNames(hit);

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

function toolSearchParams(query: string, filters: SearchFilters | undefined) {
	return {
		search: query,
		range: filters?.yearRange?.join("-") || "",
		country: filters?.country ?? [],
		institution: filters?.institution ?? [],
		collections: filters?.collection ?? [],
		sort: filters?.sort,
	};
}

function latestUserText(messages: ModelMessage[]) {
	const withoutContext = (text: string) =>
		text.replace(/<request_context>[\s\S]*?<\/request_context>/g, "");

	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const message = messages[index];
		if (message.role !== "user") continue;
		if (typeof message.content === "string") {
			return withoutContext(message.content);
		}

		return withoutContext(
			message.content
				.filter((part) => part.type === "text")
				.map((part) => part.text)
				.join("\n"),
		);
	}

	return "";
}

/** Semantic search needs the embedder this library configured. */
function hybridOptions(config: SearchConfig) {
	if (!config.search.embedder) return {};

	return {
		hybrid: {
			embedder: PLATFORM_SEARCH_EMBEDDER,
			semanticRatio: 0.5,
		},
	};
}

type SearchLogContext = {
	requestId: string;
	searchId: string;
	mode: ResearchMode;
};

function toolSearchFilters(
	compiled: ReturnType<typeof resolveSearchRequest>,
	filters: SearchFilters | undefined,
	allowedKeys?: string[],
) {
	const finalFilters = [...compiled.finalFilters];
	if (filters?.pdfOnly) {
		finalFilters.push(PDF_FILTER);
	}
	if (allowedKeys) {
		finalFilters.push(`key IN ${JSON.stringify(allowedKeys)}`);
	}
	return finalFilters;
}

async function searchOne(
	config: SearchConfig,
	query: string,
	filters: SearchFilters | undefined,
	limit: number,
	allowedKeys?: string[],
	logContext?: SearchLogContext,
) {
	if (allowedKeys?.length === 0) {
		logDevelopmentSearch("query.skipped", {
			...logContext,
			query,
			reason: "current-results-window-empty",
		});
		return { query, hits: [], totalHits: 0 };
	}

	const compiled = resolveSearchRequest(
		toolSearchParams(query, filters),
		config,
	);
	const finalFilters = toolSearchFilters(compiled, filters, allowedKeys);

	const searchOptions = {
		...hybridOptions(config),
		filter: finalFilters,
		limit,
		attributesToSearchOn: compiled.attributesToSearchOn,
		attributesToRetrieve: [...SEARCH_ATTRIBUTES],
		...(compiled.sortOption ? { sort: compiled.sortOption } : {}),
	};
	const startedAt = Date.now();

	logDevelopmentSearch("query.started", {
		...logContext,
		query,
		filters,
		allowedKeyCount: allowedKeys?.length,
		searchOptions,
	});

	try {
		const { index } = await getMeilisearchForConfig(config);
		const result = await index.search(query, searchOptions);
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
	/** Window entries in the reader's displayed order. */
	entries: ReturnType<typeof searchHitToListEntry>[];
	/** The sort applied to the reader's results (relevance when unset). */
	sort?: string[];
	start: number;
	end: number;
	total: number;
	hasMore: boolean;
	nextCursor?: string;
};

type CurrentResultsWindowChoice = "first" | "last";

async function loadCurrentResultsWindow(
	config: SearchConfig,
	searchContext: LibrarySearchContext,
	cursor: string | undefined,
	window: CurrentResultsWindowChoice,
): Promise<CurrentResultsWindow> {
	const { index } = await getMeilisearchForConfig(config);
	const compiled = resolveSearchRequest(
		searchContext,
		config,
		await resolveSearchTopicNodes(searchContext, config),
	);
	const baseOptions = {
		attributesToSearchOn: compiled.attributesToSearchOn,
		filter: compiled.finalFilters,
		...(compiled.sortOption ? { sort: compiled.sortOption } : {}),
	};

	let offset = currentResultsOffset(searchContext, cursor);
	if (!cursor && window === "last") {
		// A page-based request returns the exact total instead of an
		// estimate, so the final window can start at total - 200.
		const count = await index.search(compiled.search, {
			...baseOptions,
			hitsPerPage: 1,
			page: 1,
			attributesToRetrieve: ["key"],
		});
		offset = Math.max(0, count.totalHits - CURRENT_RESULTS_WINDOW_SIZE);
	}

	const result = await index.search(compiled.search, {
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
	const entries = hits.map((hit, hitIndex) =>
		searchHitToListEntry(hit, offset + hitIndex + 1),
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

function describeCurrentResults(
	window: CurrentResultsWindow,
	isListing: boolean,
) {
	return {
		start: window.start,
		end: window.end,
		total: window.total,
		hasMore: window.hasMore,
		nextCursor: window.nextCursor,
		order: window.sort
			? `sorted by ${window.sort.join(", ")}`
			: "relevance order as displayed",
		// The window in the reader's order, only when listing, so an ordinary
		// search result stays compact.
		...(isListing ? { entries: window.entries } : {}),
	};
}

/** Deep Research looks for publications with a PDF first unless the reader said otherwise. */
function modeFilters(mode: ResearchMode, filters: SearchFilters | undefined) {
	return mode === "research" && filters?.pdfOnly === undefined
		? { ...filters, pdfOnly: true }
		: filters;
}

const SEARCH_TOOL_DESCRIPTION =
	"Search the Evidence Library for candidate publications. Submit related query variations together so they run in parallel. Results contain discovery metadata and abstracts, not page-verifiable evidence. Before relying on a publication's substantive claims, use readPublications and cite its exact PDF page. Each hit says whether it has a PDF (hasPdf); only those can be read. Use filters.pdfOnly to return only publications with a PDF. When the request context says a current result set is available and the user refers to it, set withinCurrentResults=true: with no queries this lists one 200-entry window of those results in the user's own order (positions, keys, titles, creators, years) — use it for questions about the list itself such as counts, order, or the first/last/Nth entry (window='last' for the end of the list); with queries it searches only inside that window. At most one window per user message; to continue later, pass the nextCursor returned by the previous call.";

const READ_TOOL_DESCRIPTION =
	"Read the complete visible PDF attachments for selected Evidence Library publications. Use this before making evidence claims so every claim can identify both its publication source and exact PDF page. Use publication keys returned by searchLibrary and submit multiple keys together to read them in parallel. Prefer two or three of the most relevant publications per call: PDFs within about 20 MB per call are attached inline and cached across turns, anything beyond that is attached by link and is slower to process.";

export function createResearchTools(
	mode: ResearchMode,
	config: SearchConfig,
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
				config,
				searchContext,
				cursor,
				window,
			);
		}

		return currentWindowPromise;
	};

	return {
		searchLibrary: tool({
			description: SEARCH_TOOL_DESCRIPTION,
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
				const continuation = cursor || undefined;
				if (continuation && !withinCurrentResults) {
					throw new Error(
						"A current-results cursor requires withinCurrentResults=true.",
					);
				}

				const { effectiveFilters, ignoredFilters } =
					validateSearchFiltersAgainstUserRequest(
						modeFilters(mode, filters),
						latestUserText(messages),
					);
				const currentResults = withinCurrentResults
					? await currentResultsWindow(continuation, window)
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
					cursor: continuation,
					requestedFilters: filters,
					effectiveFilters,
					ignoredFilters,
					limitPerQuery,
				});

				return {
					appliedFilters: effectiveFilters,
					ignoredFilters,
					queries: await Promise.all(
						queries.map((query) =>
							searchOne(
								config,
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
								currentResults: describeCurrentResults(
									currentResults,
									isListing,
								),
							}
						: {}),
				};
			},
		}),
		readPublications: tool({
			description: READ_TOOL_DESCRIPTION,
			inputSchema: schemas.readPublications,
			execute: async ({ itemKeys }) => ({
				requestedItemKeys: [...new Set(itemKeys)],
			}),
			toModelOutput: async ({ input }) =>
				publicationToolModelOutput([...new Set(input.itemKeys)]),
		}),
	};
}
