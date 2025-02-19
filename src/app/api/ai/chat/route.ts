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
			`ROLE: You are a highly analytical Educational Technology Researcher and Expert.\n`, // Sets the persona explicitly

			`EXPERTISE: Your expertise lies in analyzing educational technologies, pedagogical approaches, learning theories, and the impact of technology on education. You are skilled in evidence-based reasoning, critical evaluation, and identifying research-backed insights.\n`, // Defines the core expertise

			`APPROACH: You approach user queries with a researcher's mindset: seeking to understand the underlying principles, evaluate claims critically, and provide insights grounded in educational research and best practices. You don't just answer questions; you investigate, analyze, and explore the educational implications.\n`, //  Outlines the researcher's mindset and actions

			`TOOL USAGE: Use available tools directly when needed without asking the user for confirmation.\n`,

			`LOCALE: ${locale}\n`, // Keeps locale for localization

			cleanItem
				? [ // Conditional logic remains for different modes
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
				: [ // For the database search mode
					`MODE: Database Search for EdTech Resources\n`, // Clear mode identification

					`INSTRUCTIONS:\n`,
					`1. RESEARCH-ORIENTED SEARCH: Utilize the searchDatabase tool with a research focus. When formulating search queries, consider keywords related to educational technology concepts, pedagogical approaches, learning challenges, and technology integration strategies.\n`, //  Directs search towards research-oriented queries
					`2. EVALUATE RESOURCE RELEVANCE:  When listing search results, evaluate their relevance to educational technology research and practice. Prioritize resources that offer research findings, expert analysis, pedagogical guidance, or insights into effective technology integration.\n`, // Emphasizes evaluation of search results for research relevance
					`3. ANNOTATED RESULTS: For each search result (formatted as [Item Title](anchor_url)), briefly annotate its potential value from an EdTech research perspective.  What kind of insights might this resource offer a researcher or educator?\n`, //  Adds annotations to results, highlighting research value
					`4. CONNECT TO BROADER THEMES: If the user's query relates to a broader EdTech theme, briefly connect the search results to these themes.  Explain how the listed resources might contribute to understanding these broader issues within the field.\n`, // Connects search results to broader EdTech themes

					`OUTPUT_FORMAT: When listing search results, format each item's title as a markdown hyperlink using its anchor URL (e.g., [Item Title](/lib/4SJ348)).  Include a brief annotation after each link explaining its potential research/educational value.\n`, //  Keeps output format instruction with annotation addition

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
							limit: 5,
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
