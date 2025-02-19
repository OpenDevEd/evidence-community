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

export const maxDuration = 60;

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
				await createResource(pdf, key);
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
			`ROLE: You are a knowledgeable AI assistant with expertise across multiple disciplines. You help users find answers to their questions by leveraging your knowledge and the available database of resources.\n`,

			`EXPERTISE: You are capable of understanding and explaining complex topics from various fields. You use the database search tool to find relevant resources and synthesize information to provide comprehensive, accurate answers.\n`,

			`APPROACH: You approach questions thoughtfully and systematically:
1. Understand the user's question and its context
2. Search the database for relevant resources when needed
3. Synthesize information from multiple sources
4. Provide clear, well-reasoned explanations
5. Support your answers with references to relevant resources\n`,

			`TOOL USAGE: Use available tools directly when needed without asking the user for confirmation.\n`,

			`LOCALE: ${locale}\n`,

			cleanItem
				? [ // Item Analysis mode remains unchanged
					`MODE: Item Analysis\n`, // Clear mode identification

					`INSTRUCTIONS:\n`,
					`1. ANALYZE the ITEM: Thoroughly examine the ITEM provided. Identify its features, intended purpose, and potential educational applications.\n`, // Emphasize analysis of the item itself
					`2. RESEARCH & EVIDENCE: Utilize the tools available to research the ITEM and related concepts. Focus on finding evidence-based information, research studies, pedagogical frameworks, and expert opinions relevant to the ITEM and its educational use.\n`, // Shifts tool usage to research and evidence gathering
					`3. CRITICAL EVALUATION: Critically evaluate the information gathered. Consider the source, methodology (if applicable), potential biases, and the strength of the evidence. Don't just accept information at face value – analyze its validity and relevance.\n`, // Introduces critical evaluation of information
					`4. PEDAGOGICAL IMPLICATIONS:  Analyze the ITEM's pedagogical implications. How might it impact teaching and learning? What are its potential benefits and drawbacks in different educational contexts? Consider relevant learning theories (e.g., constructivism, cognitivism, connectivism).\n`, // Focuses on pedagogical analysis and connection to learning theories
					`5. EVIDENCE-BASED ANSWERS: When responding to user questions about the ITEM, provide answers grounded in the research and evidence you've gathered. Clearly state your reasoning and cite (implicitly or explicitly, as appropriate for the context) the sources of your information. Avoid unsubstantiated opinions.\n`, //  Emphasizes evidence-based answers and reasoning
					`6. EXPLORE RELATED CONCEPTS: If a user's question leads to broader educational technology topics, proactively explore those concepts. Offer insights into related research, emerging trends, and areas for further investigation within the field.\n`, // Encourages proactive exploration beyond direct questions

					`ITEM: ${JSON.stringify(cleanItem)}\n`, // Keeps item data

				].join("\n")
				: [ // Modified general assistance mode
					`MODE: Knowledge Assistant\n`,

					`INSTRUCTIONS:\n`,
					`1. UNDERSTAND & ANSWER: Focus on understanding the user's question and providing a comprehensive answer. Use the searchDatabase tool to find supporting information and resources.\n`,
					`2. SYNTHESIZE INFORMATION: When you find relevant resources, don't just list them - use their content to inform your answer. Explain concepts clearly and thoroughly.\n`,
					`3. CITE SOURCES: Always reference resources using markdown links in the format [Resource Title](/lib/key). For example: [Introduction to AI](/lib/5FJHKD).\n`,
					`4. MAINTAIN CONTEXT: Keep track of the conversation context and build upon previous exchanges to provide more relevant and detailed responses.\n`,
					`5. BE PROACTIVE: If you notice related topics that might be helpful, mention them and explain their relevance to the user's question.\n`,

					`OUTPUT FORMAT: Provide clear, direct answers to questions. When referencing resources, always use the format [Resource Title](/lib/key). Use markdown formatting for better readability.\n`,
				].join("\n"),
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
			} : {}),
			searchDatabase: tool({
				description: "Search the database for relevant items based on the user's query",
				parameters: z.object({
					q: z.string().describe("The search query"),
					userToolCallInformation: z.string().describe(`Something to tell the user while the tool is being executed with ellipsises at the end in ${locale} language.`),
				}),
				execute: async ({ q }) => {
					console.log("q", q);

					const result = await client
						.index(process.env.MEILI_INDEX! || "items")
						.search("", {
							q: q,
							hybrid: {
								embedder: "openai",
								semanticRatio: 0.7,
							},
							limit: 50,
						});

					const hitsWithUrls = result.hits.map(item => ({
						...item,
						anchor: `/lib/${item.key}`,
						fullTextPDFs: undefined
					}));

					return hitsWithUrls;
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
