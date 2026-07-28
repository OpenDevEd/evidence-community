import "server-only";

import { getPostHogForConfig } from "./posthog";
import type { Item } from "@/app/api/item/types";
import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { buildSiteUrl } from "@/lib/site-url";
import { getMeilisearchForConfig } from "./meilisearch";

export async function trackUsage(
	config: LibraryServerConfig,
	eventName: string,
	event: any,
	distinctId: string | null | undefined,
	prompt: string
) {
	if (!distinctId) {
		return;
	}

	try {
		const posthogClient = await getPostHogForConfig(config);
		if (!posthogClient) {
			return;
		}

		const modelName = event.response.modelId;

		posthogClient.capture({
			event: eventName,
			distinctId,
			properties: {
				model: modelName,
				prompt,
				prompt_tokens: event.usage?.promptTokens,
				completion_tokens: event.usage?.completionTokens,
				total_tokens: event.usage?.totalTokens,
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
) {
	const formattedDocuments = hit._formatted?.fullTextPDFs;
	const rawDocuments = hit.fullTextPDFs ?? [];
	const documents = formattedDocuments ?? rawDocuments;
	const queryTerms = userQuery
		.toLocaleLowerCase()
		.match(/[\p{L}\p{N}]{3,}/gu) ?? [];
	const results: Array<{
		order: number;
		relevance: number;
		result: RAGResult;
	}> = [];
	let order = 0;

	for (const [documentIndex, document] of documents.entries()) {
		for (const [pageIndex, page] of document.fullTextPDF.entries()) {
			const rawPage =
				rawDocuments[documentIndex]?.fullTextPDF[pageIndex];
			const pageNumber = rawPage?.page ?? page.page;
			if (
				userSpecifiedPage !== 0 &&
				pageNumber !== userSpecifiedPage
			) {
				continue;
			}

			const highlightedText = page.text.trim();
			const text = highlightedText
				.replaceAll(HIGHLIGHT_START, "")
				.replaceAll(HIGHLIGHT_END, "");
			if (!text) continue;
			const normalizedText = text.toLocaleLowerCase();
			const lexicalMatches = queryTerms.reduce(
				(total, term) =>
					total + countOccurrences(normalizedText, term),
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
					url: buildSiteUrl(`/lib/${itemKey}`),
				},
			});
			order += 1;
		}
	}

	return results
		.sort(
			(left, right) =>
				right.relevance - left.relevance ||
				left.order - right.order,
		)
		.slice(0, 10)
		.map(({ result }) => result);
}

export const findRelevantContent = async (
	config: Pick<
		LibraryServerConfig,
		"revision" | "search" | "services" | "updatedAt"
	>,
	userQuery: string,
	itemKey: string | null,
	userSpecifiedPage: number,
): Promise<RAGResult[]> => {
	if (!itemKey || !config.search.embeddings) {
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
		),
	);
};
