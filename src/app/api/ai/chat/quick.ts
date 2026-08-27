import { ModelMessage, streamText, tool } from "ai";
import { PLATFORM_SEARCH_EMBEDDER } from "@/config/library-config/catalogs";
import { Item } from "../../item/types";
import { z } from "zod";
import { findRelevantContent, trackUsage } from "@/lib/ai";
import { SORT_OPTIONS } from "@/constants/items";
import { SearchResponse } from "meilisearch";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { cleanItemForAI, formatRange } from "@/lib/utils";
import { ItemsGetResponse } from "../../items/types";
import { getCachedItem } from "../../cache";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { ResolvedAIModels } from "@/lib/ai-provider";

export async function quickChat(
	req: Request,
	config: LibraryServerConfig,
	models: ResolvedAIModels,
	systemPrompt: string,
	locale: string,
	cleanItem: Item | null,
	coreMessages: ModelMessage[],
	fullTextPDFs: any,
	distinctId: string,
	messages: any[],
) {
	const { index: searchIndex } = await getMeilisearchForConfig(config);
	const startedAt = Date.now();
	const result = streamText({
		model: models.defaultModel,
		system: [
			systemPrompt,
			`LOCALE: ${locale}`,
			`You are an AI research assistant created by OpenDevEd (Open Development & Education) to answer questions and help users find information about EdTech. Your primary role is to analyze and synthesize research findings into well-formatted responses.`,

			`TOOL USAGE: You have powerful tools at your disposal that you should use proactively, and you are encouraged to call them multiple times if needed.
			- You can analyze PDF contents when available
			- You should use these tools automatically without asking for permission
			- You must avoid including irrelevant information in your responses
			- You should synthesize and rewrite extracted data into coherent, human-readable research summaries`,

			...(cleanItem
				? [`ITEM: ${JSON.stringify(cleanItem)}`]
				: [
						`== DECISION PROCESS ==
Before you answer, classify the user’s intent into one of two categories:

1. LIST REQUEST
   - The user wants a list of resources, papers, articles, or items.
   - Strategy:
	 • Reformulate their input into a **concise keyword-based semantic query** (avoid full sentences).
	   Example: "Give me research on adaptive learning in schools" → "adaptive learning, schools, education research".
	 • Use searchDatabase to fetch relevant items.
	 • Present a clear, concise list of items with citation links.
	 • Do not use getInformation unless the user explicitly asks for details inside a listed item.

2. QUESTION REQUEST
   - The user is asking for an explanation, evidence, or analysis (not just a list).
   - Strategy:
	 • Reformulate their question into a **keyword-based semantic query**.
	   Example: "How effective is adaptive learning for primary school students?" → "adaptive learning, primary education, effectiveness".
	 • Use searchDatabase to find promising items.
	 • Apply getInformation on those items to extract supporting evidence.
	 • If getInformation yields no relevant findings OR if the information is incomplete/insufficient:
	   – You MUST NOT produce a partial or speculative answer.
	   – Instead, reformulate the query into new **keyword variations** (synonyms, broader/narrower terms, related terminology).
	   – Run searchDatabase again.
	   – Re-apply getInformation on the new results.
	 • Repeat this search→extract cycle until relevant evidence is found or until 5 distinct attempts have been made.
	 • Only AFTER all 5 cycles fail, state clearly that no relevant research was found.

== GENERAL GUIDELINES ==
- Always prefer evidence-based insights drawn from actual research sources.
- Never output a preemptive or incomplete answer. Always retry the search cycle unless you have exhausted all attempts.
- Clean up raw extracted text so it is human-readable and concise.
- Synthesize findings across multiple items when appropriate.
- Do not include irrelevant or filler information.
- Always include citation links [📚](/lib/KEY).
- Responses should read like research summaries, not tool logs.`,
					]),
		].join("\n"),
		messages: coreMessages,
		tools: {
			getInformation: tool({
				description: `Use this tool to retrieve specific passages of research from PDFs or other sources.
- Appropriate when a user asks a direct factual question or when you need supporting evidence.
- The output may contain raw OCR/text fragments, so you must clean, summarize, and make them human-readable before returning to the user.
- You may call this tool multiple times, especially after finding potential sources with searchDatabase.`,
				inputSchema: z.object({
					userQuery: z
						.string()
						.describe(
							"The specific research question or information request you want to extract from the content.",
						),
					userSpecifiedPage: z
						.number()
						.optional()
						.default(0)
						.describe(
							"The page number specified by the user. Use 0 if the user didn’t specify.",
						),
					userToolCallInformation: z
						.string()
						.default("Analyzing content...")
						.describe(
							`A short localized (${locale}) progress message shown while the tool is working, ending with ellipses.`,
						),
					itemKey: z
						.string()
						.optional()
						.describe(
							"Supply when user asks about a specific item or when attempting to extract information from a specific item to answer a question.",
						),
				}),
				execute: async ({
					userQuery,
					userSpecifiedPage,
					itemKey: userDefinedKey,
				}: {
					userQuery: string;
					userSpecifiedPage?: number;
					itemKey?: string;
				}) => {
					if (
						(fullTextPDFs && fullTextPDFs.length > 0) ||
						!cleanItem
					) {
						const isGlobalChat = cleanItem === null;
						if (!config.search.embedder) {
							if (!isGlobalChat) {
								return (
									fullTextPDFs?.[0]?.fullTextPDF ??
									"There is no PDF attached to this item."
								);
							}
							if (!userDefinedKey) {
								return "There is no PDF attached to this item.";
							}
							try {
								const item =
									await getCachedItem(userDefinedKey);
								return (
									item?.item?.fullTextPDFs?.[0]
										?.fullTextPDF ??
									"There is no PDF attached to this item."
								);
							} catch {
								return "There is no PDF attached to this item.";
							}
						}

						const relevantContent = await findRelevantContent(
							config,
							userQuery,
							cleanItem?.key || userDefinedKey || null,
							userSpecifiedPage || 0,
						);
						return relevantContent;
					} else {
						return "There is no PDF attached to this item.";
					}
				},
			}),
			searchDatabase: tool({
				description: `Search the research database for potentially relevant items.
- Always transform the user’s request into a clear, semantic research query before calling this.
- Results may be multiple. You must analyze them, select the most relevant, and follow up with getInformation to extract details if needed.
- If there are no relevant results, state that explicitly.`,
				inputSchema: z.object({
					q: z
						.string()
						.describe(
							"A rewritten semantic search query inferred from the user’s request.",
						),
					userToolCallInformation: z
						.string()
						.describe(
							`A short localized (${locale}) progress message shown while the search runs, ending with ellipses.`,
						),
					userSpecifiedYearOrRange: z
						.string()
						.describe(
							"Year or range constraint provided by the user. Use a single year (e.g., '2020') or a range (e.g., '1991-2001'). Use '0' if none specified.",
						),
					userSpecifiedSort: z
						.string()
						.describe(
							`Sort option inferred from the user’s intent. For example, 'newest' → 'desc', 'alphabetical' → 'authorAZ'. Available: ${SORT_OPTIONS.map(
								(opt) => `${opt.key} (${opt.name})`,
							).join(", ")}`,
						),
					userSpecifiedAmountOfResults: z
						.number()
						.describe(
							"How many results the user expects. Default is 10.",
						)
						.max(50)
						.min(1)
						.default(10),
				}),
				execute: async ({
					q,
					userSpecifiedYearOrRange,
					userSpecifiedSort,
					userSpecifiedAmountOfResults,
				}) => {
					if (!config.search.embedder) {
						return { hits: [], totalHits: 0 };
					}

					let result: SearchResponse<Item>;
					try {
						result = await searchIndex.search(q, {
							q,
							hybrid: {
								embedder: PLATFORM_SEARCH_EMBEDDER,
								semanticRatio: 0.5,
							},
							filter: [
								userSpecifiedYearOrRange === "0"
									? null
									: formatRange(userSpecifiedYearOrRange),
							].filter(Boolean) as string[],
							limit: userSpecifiedAmountOfResults,
						});

						const resultIds = result.hits.map(
							(item: ItemsGetResponse["items"][number]) =>
								item.key,
						);
					} catch (e) {
						console.error(e);
						result = {
							hits: [],
							processingTimeMs: 0,
							query: q,
							totalHits: 0,
							hitsPerPage: 0,
						};
					}

					const hitsWithUrls = result.hits.map(
						(item: ItemsGetResponse["items"][number]) => ({
							...cleanItemForAI(item),
							anchor: `/lib/${item.key}`,
						}),
					);

					return {
						hits: hitsWithUrls,
						totalHits: result.totalHits,
					};
				},
			}),
		},
		// onError: (e) => {
		// 	console.error("Error in quickChat stream:", e);
		// },
		temperature: 1,
		providerOptions: {
			openai: { reasoningEffort: "low" },
			google: { thinkingConfig: { thinkingBudget: 0 } },
		},
		async onFinish(event) {
			await trackUsage(
				config,
				req,
				"chat_completion",
				event,
				distinctId,
				Date.now() - startedAt,
			);
		},
	});

	return result.toTextStreamResponse({
		headers: { "Content-Type": "text/event-stream" },
	});
}
