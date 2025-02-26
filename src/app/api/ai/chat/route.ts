import config from "@/constants/config.json";
import {
	convertToCoreMessages,
	streamText,
	tool
} from "ai";
import { getCachedItem } from "../../cache";
import { NextResponse } from "next/server";
import { createResource, findRelevantContent, getModel, trackUsage } from "@/lib/ai";
import { routing } from "@/i18n/routing";
import { cleanItemForAI, isAIAllowed } from "@/lib/utils";
import { z } from "zod";
import client from "@/lib/meilisearch";
import { SORT_OPTIONS } from "@/constants/items";
import { formatRange } from "@/lib/utils";
import { SearchResponse } from "meilisearch";
import { Item } from "../../item/types";
import { ItemsGetResponse } from "../../items/types";
// import fs from "fs";

export const maxDuration = 240;

const EmbeddedItems = new Set<string>();

export async function POST(req: Request) {
	const { distinctId, messages, key, modelIndex, smartScreeningFields } = await req.json();
	const locale = req.headers.get("Accept-Language") || routing.defaultLocale;

	console.log("smartScreeningFields", smartScreeningFields);

	let item = null;
	if (key) {
		item = await getCachedItem(key);
		if (!item || !item.item) {
			return new NextResponse("Item not found", { status: 404 });
		}

		for (const pdf of item.item.fullTextPDFs || []) {
			if (!EmbeddedItems.has(pdf.key)) {
				console.log("Creating resource for", pdf.key);
				await createResource(pdf, key);
				console.log("Resource created for", pdf.key);
				EmbeddedItems.add(pdf.key);
			}
		}
	}

	const { provider, modelName, error } = getModel(modelIndex);
	if (error) {
		return new NextResponse(error, { status: 404 });
	}

	const fullTextPDFs = item?.item?.fullTextPDFs;
	const cleanItem = item?.item ? { ...item.item, fullTextPDFs: undefined } : null;
	if (cleanItem && !isAIAllowed(cleanItem)) {
		return new NextResponse("AI not allowed", { status: 403 });
	}

	const coreMessages = convertToCoreMessages(messages).filter(
		(message) => message.content.length > 0
	);

	const result = streamText({
		model: provider!(modelName!),
		system: [
			`LOCALE: ${locale}`,
			`TOOL USAGE: You have powerful tools at your disposal that you should use proactively:
			- You can analyze PDF contents when available
			- You should use these tools automatically without asking for permission
			- You should NOT include unrelevant information in your response, if it doesn't directly answer the user's question then don't include it.
			You are an expert at using these tools to find relevant information and synthesize findings.`,
			...(cleanItem ? [
				`ITEM: ${JSON.stringify(cleanItem)}`,
			] : [
				`You are an AI research assistant specializing in educational technology (EdTech). Your primary role is to analyze and synthesize research findings into well-formatted responses.

				When responding:
				- Write in clear, cohesive paragraphs
				- Include citation links: [📚](/lib/KEY)
				- Focus on evidence-based insights
				- Maintain an objective, analytical tone

				You can help users in two main ways:
				1. When the user asks for a list of "resources" or "items" or "papers" or "articles": use the searchDatabase tool to find relevant research sources, then synthesize key findings, you can use the function searchDatabase multiple times if needed.
				Example: "What are the latest research papers on adaptive learning?"
				2. When the user asks a direct question about any topic: use the getInformation tool to extract and analyze relevant details from PDFs, providing the page number of the content you are citing, you can use the function getInformation multiple times if needed, it does not require a key but YOU can provide a key if the user wants more information regarding previously provided items.
				Example: "What are the key areas of focus for the proposed Academic Recovery Programme (ARP) in the OECS region?"

				In both cases, always provide citation links to the source documents.

				You are encouraged to use the getInformation tool multiple times to answer the user's question, you can also use the searchDatabase tool multiple times if needed.

				EXAMPLE:
				"Research has demonstrated that adaptive learning technologies can improve student performance by an average of 0.5 standard deviations in mathematics courses, with the strongest gains observed among struggling students. These systems use real-time data to adjust difficulty levels and provide personalized feedback, creating more engaging learning experiences. [📚](/lib/XYZ789)"

				Remember: Your responses should read like a coherent research summary that synthesizes findings from the available research.`
			])
		].join("\n"),
		messages: coreMessages,
		maxSteps: 10,
		tools: {
			getInformation: tool({
				description: `If the user asks for specific information that is not present in your knowledge base, or references a page or a PDF, ` +
					`use this tool to access PDF pages and content without asking for confirmation. ` +
					`The data you receive will most likely not be coherent, so you should make it human readable before returning it to the user.`,
				parameters: z.object({
					userQuery: z.string().describe("The user's query"),
					userSpecifiedPage: z.number()
						.describe("The page number specified by the user. 0 if no specific page is requested."),
					userToolCallInformation: z.string().describe(`Something to tell the user while the tool is being executed with ellipsises at the end in ${locale} language.`),
					userDefinedKey: z.string().optional().describe("OPTIONAL: Only provide a key if the user explicitly asks for more information about a specific item that was previously mentioned. Leave this empty if unsure or if no specific item was referenced."),
				}),
				execute: async ({ userQuery, userSpecifiedPage, userDefinedKey }) => {
					if ((fullTextPDFs && fullTextPDFs.length > 0) || (!cleanItem)) {
						console.log("userQuery", userQuery);
						console.log("userSpecifiedPage", userSpecifiedPage);
						const relevantContent = await findRelevantContent(userQuery, cleanItem?.key || userDefinedKey || null, userSpecifiedPage);
						console.log("relevantContent", relevantContent);
						return relevantContent;
					} else {
						return "There is no PDF attached to this item.";
					}
				}
			}),
			searchDatabase: tool({
				description: "Search the database for relevant items based on the user's query, this tool may return multiple results, you should analyze them and select the most relevant ones and if there are no relevant results, you should just say that there are no relevant results.",
				parameters: z.object({
					q: z.string().describe("The search query"),
					userToolCallInformation: z.string().describe(`Something to tell the user while the tool is being executed with ellipsises at the end in ${locale} language.`),
					userSpecifiedYearOrRange: z.string().describe("The year or year range specified by the user. Format: single year (e.g., '2020') or year range (e.g., '1991-2001'). '0' if no year is specified."),
					userSpecifiedSort: z.string().describe("Infer the sort option from user's intent. For example, if they mention 'newest' or 'recent', use 'desc', or if they mention 'alphabetical', use 'authorAZ'. Available options: " +
						SORT_OPTIONS.map(opt => `${opt.key} (${opt.name})`).join(', ')),
					userSpecifiedAmountOfResults: z.number().describe("The amount of results the user wants to see. Default is 10.").max(50).min(1).default(10),
				}),
				execute: async ({ q, userSpecifiedYearOrRange, userSpecifiedSort, userSpecifiedAmountOfResults }) => {
					console.log("userSpecifiedYearOrRange", userSpecifiedYearOrRange);
					console.log("userSpecifiedSort", userSpecifiedSort);
					console.log("q", q);

					let result: SearchResponse<Item>;
					try {
						result = await client
							.index(process.env.MEILI_INDEX! || "items")
							.search("", {
								q: q,
								hybrid: {
									embedder: "openai",
									semanticRatio: 1,
								},
								filter: [
									userSpecifiedYearOrRange === "0" ? null : formatRange(userSpecifiedYearOrRange)
								].filter(Boolean) as string[],
								limit: userSpecifiedAmountOfResults,
							});
					}
					catch (e) {
						result = { hits: [], processingTimeMs: 0, query: q, totalHits: 0, hitsPerPage: 0 };
						console.error(e);
					}

					const hitsWithUrls = result.hits.map((item: ItemsGetResponse['items'][number]) => ({
						...cleanItemForAI(item),
						anchor: `/lib/${item.key}`,
					}));

					return {
						hits: hitsWithUrls,
						totalHits: result.totalHits
					}
				}
			}),
		},
		onFinish(event) {
			trackUsage("chat_completion", event, distinctId, messages.at(-1)?.content);
		},
	});

	return result.toDataStreamResponse({
		headers: {
			'Content-Type': 'text/event-stream',
		},
	});
}
