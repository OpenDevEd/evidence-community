import "server-only";

import type { Item } from "@/app/api/item/types";
import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { buildSiteUrl } from "@/lib/site-url";
import { getMeilisearchForConfig } from "./meilisearch";
import {
	captureServerAnalyticsEvent,
	getServerAnalyticsContext,
} from "@/lib/server-analytics";

type AIUsage = {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
	inputTokenDetails?: {
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	outputTokenDetails?: {
		reasoningTokens?: number;
	};
};

type AIUsageResult = {
	finishReason?: string;
	response?: { modelId?: string };
	totalUsage?: AIUsage;
	usage?: AIUsage;
};

export async function trackUsage(
	config: LibraryServerConfig,
	request: Request,
	eventName: string,
	event: AIUsageResult,
	distinctId: string | null | undefined,
	durationMs: number,
) {
	try {
		const usage = event.totalUsage ?? event.usage;
		const context = getServerAnalyticsContext(
			config,
			request,
			distinctId ?? undefined,
		);

		await captureServerAnalyticsEvent(config, {
			event: eventName,
			context,
			properties: {
				model: event.response?.modelId ?? "unknown",
				status: "completed",
				finish_reason: event.finishReason ?? "unknown",
				duration_ms: Math.max(0, Math.round(durationMs)),
				input_tokens: usage?.inputTokens,
				output_tokens: usage?.outputTokens,
				total_tokens: usage?.totalTokens,
				cache_read_tokens: usage?.inputTokenDetails?.cacheReadTokens,
				cache_write_tokens: usage?.inputTokenDetails?.cacheWriteTokens,
				reasoning_tokens: usage?.outputTokenDetails?.reasoningTokens,
			},
		});
	} catch (error) {
		console.error("Failed to record AI usage analytics", error);
	}
}

export interface RAGResult {
	name: string;
	similarity: number;
	page: number;
	parentKey: string | null;
	url?: string;
}

type PDFPage = { page: number; text: string };
type PDFDocument = { fullTextPDF: PDFPage[] };
type RAGSearchHit = Pick<Item, "key"> & {
	fullTextPDFs?: PDFDocument[];
	_formatted?: {
		fullTextPDFs?: PDFDocument[];
	};
	_rankingScore?: number;
};

const HIGHLIGHT_START = "__EL_MATCH_START__";
const HIGHLIGHT_END = "__EL_MATCH_END__";

function countOccurrences(value: string, search: string) {
	let count = 0;
	let position = 0;
	while ((position = value.indexOf(search, position)) !== -1) {
		count += 1;
		position += search.length;
	}
	return count;
}

function extractRAGPassages(
	hit: RAGSearchHit,
	itemKey: string,
	userQuery: string,
	userSpecifiedPage: number,
	baseUrl: string,
) {
	const formattedDocuments = hit._formatted?.fullTextPDFs;
	const rawDocuments = hit.fullTextPDFs ?? [];
	const documents = formattedDocuments ?? rawDocuments;
	const queryTerms =
		userQuery.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [];
	const results: Array<{
		order: number;
		relevance: number;
		result: RAGResult;
	}> = [];
	let order = 0;

	for (const [documentIndex, document] of documents.entries()) {
		for (const [pageIndex, page] of document.fullTextPDF.entries()) {
			const rawPage = rawDocuments[documentIndex]?.fullTextPDF[pageIndex];
			const pageNumber = rawPage?.page ?? page.page;
			if (userSpecifiedPage !== 0 && pageNumber !== userSpecifiedPage) {
				continue;
			}

			const highlightedText = page.text.trim();
			const text = highlightedText
				.replaceAll(HIGHLIGHT_START, "")
				.replaceAll(HIGHLIGHT_END, "");
			if (!text) continue;
			const normalizedText = text.toLocaleLowerCase();
			const lexicalMatches = queryTerms.reduce(
				(total, term) => total + countOccurrences(normalizedText, term),
				0,
			);
			const highlightedMatches = countOccurrences(
				highlightedText,
				HIGHLIGHT_START,
			);
			results.push({
				order,
				relevance: highlightedMatches * 100 + lexicalMatches,
				result: {
					name: text,
					similarity: hit._rankingScore ?? 0,
					page: pageNumber,
					parentKey: itemKey,
					url: buildSiteUrl(`/lib/${itemKey}`, baseUrl),
				},
			});
			order += 1;
		}
	}

	return results
		.sort(
			(left, right) =>
				right.relevance - left.relevance || left.order - right.order,
		)
		.slice(0, 10)
		.map(({ result }) => result);
}

export const findRelevantContent = async (
	config: Pick<
		LibraryServerConfig,
		"revision" | "search" | "services" | "updatedAt" | "identity"
	>,
	userQuery: string,
	itemKey: string | null,
	userSpecifiedPage: number,
): Promise<RAGResult[]> => {
	if (!itemKey || !config.search.embedder) {
		return [];
	}

	const { index } = await getMeilisearchForConfig(config);
	const result = await index.search<RAGSearchHit>(userQuery, {
		hybrid: {
			embedder: PLATFORM_SEARCH_EMBEDDER,
			semanticRatio: 1,
		},
		filter: `key = ${JSON.stringify(itemKey)}`,
		attributesToRetrieve: ["key", "fullTextPDFs"],
		attributesToCrop: ["fullTextPDFs.fullTextPDF.text:300"],
		attributesToHighlight: ["fullTextPDFs.fullTextPDF.text"],
		cropMarker: " … ",
		highlightPreTag: HIGHLIGHT_START,
		highlightPostTag: HIGHLIGHT_END,
		showRankingScore: true,
		limit: 1,
	});

	return result.hits.flatMap((hit) =>
		extractRAGPassages(
			hit as RAGSearchHit,
			itemKey,
			userQuery,
			userSpecifiedPage,
			config.identity.baseUrl,
		),
	);
};
