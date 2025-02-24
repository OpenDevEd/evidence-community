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
import { isAIAllowed } from "@/lib/utils";
import { z } from "zod";
import client from "@/lib/meilisearch";
import { SORT_OPTIONS } from "@/constants/items";
import { formatRange } from "@/lib/utils";
import { SearchResponse } from "meilisearch";
import { Item } from "../../item/types";
// import fs from "fs";

export const maxDuration = 120;

const EmbeddedItems = new Set<string>();

export async function POST(req: Request) {
	const { distinctId, messages, key, modelIndex } = await req.json();
	const locale = req.headers.get("Accept-Language") || routing.defaultLocale;

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
				`You are an analytical expert in educational technology (EdTech), specializing in analyzing research, trends, and innovations in digital learning. Your expertise includes:
				- Deep understanding of educational research and methodologies
				- Analysis of learning technologies and their effectiveness
				- Knowledge of educational policies and their implementation
				- Ability to evaluate educational tools and platforms
				
				You can search through a vast database of educational research and materials using semantic search to find relevant information. When users ask questions, you should:
				1. Analyze their query to identify key educational concepts
				2. Use the search tools to find relevant research and materials
				3. Synthesize findings into clear, evidence-based responses
				4. Place resource references ONLY at the end of paragraphs or analysis sections using [RESOURCE /lib/KEY RESOURCE/] format
				
				Example format:
				"Studies have shown that gamification can increase student engagement in online learning environments by up to 45%, with particular effectiveness in mathematics and science subjects. [RESOURCE /lib/ABC123 RESOURCE/]
				
				Further research indicates that the most successful implementations combine points-based systems with meaningful feedback loops. [RESOURCE /lib/XYZ789 RESOURCE/]"
				
				Never embed resource references within sentences. Always maintain an analytical and objective perspective, focusing on research-backed insights rather than opinions.`
			])
		].join("\n"),
		messages: coreMessages,
		maxSteps: 10,
		tools: {
			...(cleanItem && item?.item?.fullTextPDFs ? {
				getInformation: tool({
					description: `If the user asks for specific information that is not present in your knowledge base, or references a page or a PDF, ` +
						`use this tool to access PDF pages and content without asking for confirmation. ` +
						`The data you receive will most likely not be coherent, so you should make it human readable before returning it to the user.`,
					parameters: z.object({
						userQuery: z.string().describe("The user's query"),
						userSpecifiedPage: z.number()
							.describe("The page number specified by the user. 0 if no specific page is requested."),
						userToolCallInformation: z.string().describe(`Something to tell the user while the tool is being executed with ellipsises at the end in ${locale} language.`),
					}),
					execute: async ({ userQuery, userSpecifiedPage }) => {
						if (fullTextPDFs && fullTextPDFs.length > 0) {
							console.log("userQuery", userQuery);
							console.log("userSpecifiedPage", userSpecifiedPage);
							const relevantContent = await findRelevantContent(userQuery, cleanItem.key, userSpecifiedPage);
							console.log("relevantContent", relevantContent);
							return relevantContent;
						} else {
							return "There is no PDF attached to this item.";
						}
					}
				}),
			} : {
				searchDatabase: tool({
					description: "Search the database for relevant items based on the user's query, this tool may return multiple results, you should analyze them and select the most relevant ones and if there are no relevant results, you should just say that there are no relevant results.",
					parameters: z.object({
						q: z.string().describe("The search query"),
						userToolCallInformation: z.string().describe(`Something to tell the user while the tool is being executed with ellipsises at the end in ${locale} language.`),
						userSpecifiedYearOrRange: z.string().describe("The year or year range specified by the user. Format: single year (e.g., '2020') or year range (e.g., '1991-2001'). '0' if no year is specified."),
						userSpecifiedSort: z.string().describe("Infer the sort option from user's intent. For example, if they mention 'newest' or 'recent', use 'desc', or if they mention 'alphabetical', use 'authorAZ'. Available options: " +
							SORT_OPTIONS.map(opt => `${opt.key} (${opt.name})`).join(', ')),
					}),
					execute: async ({ q, userSpecifiedYearOrRange, userSpecifiedSort }) => {
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
									limit: 50,
								});
						}
						catch (e) {
							result = { hits: [], processingTimeMs: 0, query: q, totalHits: 0, hitsPerPage: 0 };
							console.error(e);
						}

						const hitsWithUrls = result.hits.map((item: any) => ({
							...item,
							anchor: `/lib/${item.key}`,
							fullTextPDFs: undefined,
							tags: undefined
						}));

						// if (!fs.existsSync("temp")) {
						// 	fs.mkdirSync("temp");
						// }
						// fs.writeFileSync(`temp/result-${Date.now()}.json`, JSON.stringify(result, null, 2));

						return {
							hits: hitsWithUrls,
							totalHits: result.totalHits
						}
					}
				}),
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
