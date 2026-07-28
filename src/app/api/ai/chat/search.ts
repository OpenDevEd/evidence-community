import {
	streamText,
	generateObject,
	generateId,
	ModelMessage,
	createUIMessageStream,
	createUIMessageStreamResponse,
} from "ai";
import { z } from "zod";
import { cleanItemForAI, formatRange, getTimeDuration } from "@/lib/utils";
import { getMeilisearchForConfig } from "@/lib/meilisearch";
import { SearchResponse } from "meilisearch";
import { Item } from "../../item/types";
import { ALL_LABELS_IN_COUNTRY_HIERARCHY } from "@/constants/misc";
import { createCountryFilters } from "@/lib/country";
import { EXCLUDED_ITEM_TYPES } from "@/constants/items";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { ResolvedAIModels } from "@/lib/ai-provider";

const Agent1Schema = z.object({
	original_question: z
		.string()
		.describe(
			"The user's most recent question that needs to be addressed."
		),
	analytical_sub_questions: z
		.array(z.string())
		.default([])
		.describe(
			"A list of analytical sub-questions or lines of inquiry derived from the original question to guide research. Empty if the original question is simple and direct."
		),
	search_queries: z
		.array(
			z.object({
				for_question: z
					.string()
					.describe(
						"The original or sub-question this search query is designed to find evidence for."
					),
				query: z
					.string()
					.describe(
						"A concise, targeted search query/keywords for finding relevant evidence or context."
					),
			})
		)
		.default([])
		.describe(
			"A list of search queries to find information for the original/sub-questions."
		),
	geographical_region: z
		.array(z.string())
		.optional()
		.describe(
			"Identified countries, continents, or subcontinents mentioned in the user's question, if any. Extract the exact terms used by the user and return as an array."
		),
	requested_result_count: z
		.number()
		.int()
		.min(1)
		.max(50)
		.optional()
		.describe(
			"The number of search results the user requested, if specified. Should be between 1 and 50."
		),
});
type Agent1Response = z.infer<typeof Agent1Schema>;

const AssessedEvidenceSchema = z.object({
	assessed_item_title: z
		.string()
		.describe("The title of the item being assessed."),
	assessed_item_citation_key: z
		.string()
		.describe("The citationKey of the item being assessed."),
	original_question_context: z
		.string()
		.describe("The original or sub-question this item was retrieved for."),
	relevance_summary: z
		.string()
		.describe(
			"A brief summary of the item's relevance and key contribution to the question_context, highlighting specific facts, findings, or arguments."
		),
	analytical_notes: z
		.string()
		.optional()
		.describe(
			"Additional analytical notes, e.g., how this item might connect to others, potential biases if discernible, or specific strong/weak points of the evidence provided by this item for the question."
		),
});
type AssessedEvidence = z.infer<typeof AssessedEvidenceSchema>;

const Agent2Point5OutputSchema = z.object({
	assessed_evidence_groups: z
		.array(
			z.object({
				for_question: z.string(),
				items: z.array(AssessedEvidenceSchema),
			})
		)
		.describe(
			"A list of groups of assessed evidence, where each group corresponds to a (sub-)question."
		),
});
type Agent2Point5Response = z.infer<typeof Agent2Point5OutputSchema>;

const FinalAnswerSchema = z.object({
	analytical_answer_text: z
		.string()
		.describe(
			"The comprehensive, analytical, and well-cited answer to the user's question, synthesized from the provided evidence, with citations in the format [📚](/lib/KEY)."
		),
});

interface RetrievedDatabaseItem {
	question_context: string;
	items: Array<{
		title: string;
		description?: string;
		anchor: string;
		citationKey: string;
	}>;
}

export async function getAnswerFromSearchAgentic(
	config: LibraryServerConfig,
	models: ResolvedAIModels,
	systemPrompt: string,
	userQuestion: string,
	messagesHistory: ModelMessage[],
	locale: string
) {
	const startTime = Date.now();
	const { index: searchIndex } =
		await getMeilisearchForConfig(config);
	if (!config.search.embeddings) {
		throw new Error("Semantic search is disabled");
	}

	const stream = createUIMessageStream({
		execute: async ({ writer }) => {
			const currentMessages: ModelMessage[] = [
				...messagesHistory,
				{ role: "user", content: userQuestion },
			];

			writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
					"Starting advanced research workflow..."
				}
			});

			let researchPlan: Agent1Response = {
				original_question: userQuestion,
				analytical_sub_questions: [],
				search_queries: [
					{ for_question: userQuestion, query: userQuestion },
				],
				geographical_region: [],
			};

			try {
				writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
						"Generating research plan..."
				}
			});

				const agent1SystemPrompt = `You are an expert research assistant with excellent conversational skills. Your task is to analyze the user's most recent question in the context of the entire conversation history, and develop a research plan for finding relevant information in a document database.

First, carefully analyze the entire conversation history to understand the context. If the user's most recent message:
1. References previous topics with pronouns or implicit references (e.g., "Tell me more about this" or "What about its impact?")
2. Builds on previously discussed subjects without explicitly naming them
3. Uses shorthand or abbreviated references to previously mentioned concepts

Then generate a new, explicit "original_question" that incorporates the full context. This should be a complete, standalone question that someone without access to the conversation history would understand.

For example:
- If previous messages discussed "EdTech in Africa" and the user asks "What about implementation challenges?", the original_question should be "What are the implementation challenges of EdTech in Africa?"
- If the conversation was about "teacher training programs" and the user asks "Compare these with online approaches", the original_question should be "How do traditional teacher training programs compare with online approaches?"

The user's most recent question is: "${userQuestion}". This must be the basis for your 'original_question', expanded with context as needed.

Based on this contextual understanding:
1.  Set the 'original_question' field to your expanded, context-aware version of the user's most recent question.
2.  Analyze the question to infer any mentioned geographical regions (countries, continents, or subcontinents). For each potential region identified, find the best equivalent match from the following list of valid labels. Set the 'geographical_region' field to an array containing *only* the exact terms used by the user that match a valid label. If no valid regions are mentioned or found, set 'geographical_region' to an empty array [].
    Valid Geographical Labels: ${ALL_LABELS_IN_COUNTRY_HIERARCHY.join(", ")}
3.  Look for any indication in the user's question of a desired number of search results (e.g., "give me 10 results", "show 25 items"). If a number is found, set the 'requested_result_count' field to this number, ensuring it is an integer between 1 and 50. If no number is specified, or if it's outside this range, leave 'requested_result_count' as undefined.
4.  If the question is complex or multi-faceted, break it down into 2-4 specific 'analytical_sub_questions' or distinct lines of inquiry. These sub-questions should guide a structured investigation. If the question is simple, this array can be empty.
5.  For the 'original_question' (and each 'analytical_sub_questions', if any), generate 1-2 highly targeted search queries.
Focus on creating queries that will yield precise results.
You must output an object conforming to the provided schema.`;

				const { object: parsedPlan } = await generateObject({
					model: models.smallModel,
					providerOptions: {
						google: { thinkingConfig: { thinkingBudget: 0 } },
						openai: { reasoningEffort: "low" },
					},
					schema: Agent1Schema,
					system: agent1SystemPrompt,
					messages: currentMessages,
					temperature: 1,
				});

				writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) + "Research plan generated"
				}
			});

				researchPlan = { ...researchPlan, ...parsedPlan };

				if (
					!researchPlan.geographical_region ||
					!Array.isArray(researchPlan.geographical_region)
				) {
					researchPlan.geographical_region = [];
				}

				if (!researchPlan.original_question && userQuestion) {
					researchPlan.original_question = userQuestion;
				}
			} catch (error) {
				writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
						"Error generating research plan."
				}
			});
			}

			const retrievedDatabaseItemsGroups: RetrievedDatabaseItem[] = [];

			const requestedLimitPerQuery = researchPlan.requested_result_count
				? Math.max(
						20,
						Math.min(
							50,
							Math.ceil(
								(researchPlan.requested_result_count * 2) /
									researchPlan.search_queries.length
							)
						)
				  )
				: 20;

			let geoFilters: string[] = [];
			if (
				researchPlan.geographical_region &&
				researchPlan.geographical_region.length > 0
			) {
				try {
					geoFilters = createCountryFilters(
						researchPlan.geographical_region,
						[]
					);
				} catch (filterError) {
					geoFilters = [];
				}
			}

			for (const searchQueryInstruction of researchPlan.search_queries) {
				try {
					writer.write({
						type: "data-status",
						id: generateId(),
						data: {
							type: "event",
							message:
								getTimeDuration(startTime) +
								`Searching for: ${searchQueryInstruction.query}`,
						}
					});

					const inferredYearRange = "0";
					const inferredSort = "desc";
					const inferredAmount = requestedLimitPerQuery;

					const result: SearchResponse<Item> =
						await searchIndex.search("", {
							q: searchQueryInstruction.query,
							hybrid: { embedder: "openai", semanticRatio: 1 },
							filter: [
								inferredYearRange === "0"
									? null
									: formatRange(inferredYearRange),
								`itemType NOT IN ${JSON.stringify(
									EXCLUDED_ITEM_TYPES
								)}`,
								"deleted != 1",
								config.content.tags.hidden.length
									? `tags NOT IN ${JSON.stringify(config.content.tags.hidden)}`
									: null,
								...geoFilters,
							].filter(Boolean) as string[],
							limit: inferredAmount,
						});

					writer.write({
						type: "data-status",
						id: generateId(),
						data: {
							type: "event",
							message:
								getTimeDuration(startTime) +
								`Found ${result.hits.length} items for query: ${searchQueryInstruction.query}`,
						}
					});

					const itemsForThisQuery = result.hits.map((item: Item) => ({
						title: item.title || "Untitled",
						description: item.abstractNote || "",
						anchor: `/lib/${item.key}`,
						citationKey: item.key,
					}));

					if (itemsForThisQuery.length > 0) {
						retrievedDatabaseItemsGroups.push({
							question_context:
								searchQueryInstruction.for_question,
							items: itemsForThisQuery,
						});
					}
				} catch (searchError) {
					writer.write({
						type: "data-status",
						id: generateId(),
						data: {
							type: "event",
							message:
								getTimeDuration(startTime) +
								`Search failed for query: ${searchQueryInstruction.query}`,
						}
					});
				}
			}

			const totalRetrievedItems = retrievedDatabaseItemsGroups.reduce(
				(count, group) => count + group.items.length,
				0
			);

			if (retrievedDatabaseItemsGroups.length === 0) {
				writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
						"No relevant items found in search."
				}
			});
			}

			let allAssessedEvidence: Agent2Point5Response = {
				assessed_evidence_groups: [],
			};
			try {
				if (retrievedDatabaseItemsGroups.length > 0) {
					writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
							"Assessing relevance of retrieved items..."
				}
			});

					const agent2Point5SystemPrompt = `You are a meticulous research assistant with a critical eye for relevance. Your task is to strictly assess retrieved document snippets and summarize *only* those highly relevant to specific research questions.\nFor each provided "Retrieved Item Group" which contains items retrieved for a "Question Context":\n1.  For each individual "Item" within that group:\n    a.  Critically evaluate the item's 'title' and 'description' (and potentially other fields if available in the raw item) against the "Question Context".\n    b.  Determine if the item is *highly and directly relevant* to the specific question context. Avoid including tangentially related or background information unless it directly supports a relevant point.\n    c.  If the item is *highly relevant*:\n        i.  Identify its 'title' and 'citationKey'.\n        ii. Write a concise 'relevance_summary' (1-2 sentences) clearly stating the key information, fact, or argument the item provides *in relation to the 'Question Context'*. Be specific about its contribution.\n        iii. (Optional) Provide 'analytical_notes' (1 sentence) if you spot any immediate connections to potential broader themes, very obvious strengths/weaknesses of this piece of evidence for the question, or if it directly corroborates/contradicts a general idea (without needing to cross-reference other items yet).\n    d.  If the item is *not highly relevant*, completely **exclude** it from your output for this group.\n2.  Construct your output object using the 'Agent2Point5OutputSchema'. For each input "Retrieved Item Group", create a corresponding group in your 'assessed_evidence_groups'. Include *only* the items that you assessed as highly relevant in the 'items' array for that group.\n    If, after assessment, *no* items from an input group are found highly relevant, include that group in your output with an empty 'items' array.

You MUST output an object conforming to the 'Agent2Point5OutputSchema'.\nEnsure each 'assessed_item_citation_key' matches the input item's 'citationKey' for included items.\nEnsure 'original_question_context' in your output matches the 'question_context' from the input group.\nYour output should *only* contain groups and items that passed your relevance assessment.`;

					const contextForAgent2Point5 = `The overall research is guided by the user's original question: "${
						researchPlan.original_question
					}"\n${
						researchPlan.analytical_sub_questions.length > 0
							? `It has been broken down into these lines of inquiry: ${researchPlan.analytical_sub_questions.join(
									", "
							  )}`
							: ""
					}\n\nHere are the retrieved item groups to assess:\n${retrievedDatabaseItemsGroups
						.map(
							(group) =>
								`\nGroup for Question Context: "${
									group.question_context
								}"\nItems:\n${group.items
									.map(
										(item) =>
											`- Title: "${
												item.title
											}", Description: "${item.description?.substring(
												0,
												500
											)}...", CitationKey: ${
												item.citationKey
											}`
									)
									.join("\n")}\n`
						)
						.join("\n---\n")}\n`;
					const { object: assessedEvidenceResult } =
						await generateObject({
							model: models.smallModel,
							providerOptions: {
								google: {
									thinkingConfig: { thinkingBudget: 0 },
								},
								openai: { reasoningEffort: "low" },
							},
							schema: Agent2Point5OutputSchema,
							system: agent2Point5SystemPrompt,
							messages: [
								{
									role: "user",
									content: `Please assess the following retrieved items based on the schema and instructions:\n${contextForAgent2Point5}`,
								},
							],
							temperature: 1,
						});
					allAssessedEvidence = assessedEvidenceResult;
					writer.write({
						type: "data-status",
						id: generateId(),
						data: {
							type: "event",
							message:
								getTimeDuration(startTime) +
								`Assessment complete. ${allAssessedEvidence.assessed_evidence_groups.reduce(
									(count, group) => count + group.items.length,
									0
								)} items deemed relevant.`,
						}
					});
				} else {
					writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
							"Skipping assessment - no items retrieved."
				}
			});
				}
			} catch (error) {
				writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
						"Error during relevance assessment."
				}
			});
			}

			let synthesisContextForAI = "";

			if (
				researchPlan.requested_result_count &&
				totalRetrievedItems < researchPlan.requested_result_count
			) {
				synthesisContextForAI += `Note to AI: The user requested ${researchPlan.requested_result_count} results, but only ${totalRetrievedItems} relevant items were found across all searches. Please mention this limitation to the user, stating that these are the best results found based on the query and available information.\n\n`;
			}

			if (allAssessedEvidence.assessed_evidence_groups.length > 0) {
				synthesisContextForAI = "--- Assessed Research Evidence ---\n";
				synthesisContextForAI +=
					allAssessedEvidence.assessed_evidence_groups
						.map((group) => {
							let groupContext = `Evidence related to question: "${group.for_question}":\n`;
							if (group.items.length === 0) {
								groupContext +=
									"No specific items were assessed as highly relevant for this question.\n";
							} else {
								groupContext += group.items
									.map(
										(item) =>
											`Item Title: "${item.assessed_item_title}" (CitationKey: ${item.assessed_item_citation_key})\n` +
											`Relevance Summary: ${item.relevance_summary}\n` +
											(item.analytical_notes
												? `Analytical Notes: ${item.analytical_notes}\n`
												: "")
									)
									.join("---\n");
							}
							return groupContext;
						})
						.join("\n\n=====\n\n");
			} else if (
				retrievedDatabaseItemsGroups.length > 0 &&
				allAssessedEvidence.assessed_evidence_groups.length === 0
			) {
				synthesisContextForAI =
					"--- Retrieved Raw Database Items (Assessment Failed) ---\n";
				synthesisContextForAI += retrievedDatabaseItemsGroups
					.map(
						(group) =>
							`Context for "${group.question_context.replace(
								/"/g,
								'\\"'
							)}\":\n` +
							group.items
								.map(
									(item) =>
										`Item Title: "${item.title.replace(
											/"/g,
											'\\"'
										)}" (CitationKey: ${
											item.citationKey
										})\n` +
										(item.description
											? `Description: "${item.description.replace(
													/"/g,
													'\\"'
											  )}"\n`
											: "")
								)
								.join("---\n")
					)
					.join("\n\n=====\n\n");
				synthesisContextForAI +=
					"\nNote: The evidence assessment step encountered an issue. Synthesize based on the raw data provided.";
			} else {
				synthesisContextForAI =
					"No relevant items were found or assessed from the database for the generated search queries. The database might not contain information relevant to the user's question.";
			}

			writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) + "Thinking..."
				}
			});

			const subQuestionsContext =
				researchPlan.analytical_sub_questions &&
				researchPlan.analytical_sub_questions.length > 0
					? `The research was guided by these analytical sub-questions or lines of inquiry:\n${researchPlan.analytical_sub_questions
							.map((sq) => `- ${sq}`)
							.join(
								"\n"
							)}\nYour answer should ideally address these aspects.`
					: "The user's question should be addressed directly and comprehensively based on the evidence.";

			const agent3SystemPrompt = `You are an expert AI research analyst from OpenDevEd, specializing in EdTech. Your task is to synthesize available research evidence into a comprehensive, analytical, and meticulously cited answer to the user's question.\nYou MUST base your answer *exclusively* on the "Assessed Research Evidence" provided below. Do not use external knowledge or make assumptions beyond this evidence.\nYour response should be a direct, coherent, and well-structured answer. Do NOT mention "items," "provided text," "database results," or the process of information retrieval in your answer. Act as if you have an intrinsic understanding of the relevant research.\n
User's Original Question: "${researchPlan.original_question.replace(
				/"/g,
				'\\"'
			)}"\n${subQuestionsContext}\n
${synthesisContextForAI}\n--- End of Assessed Research Evidence ---\n
Your Analytical Task:
1. Deeply understand the User's Original Question and any guiding analytical sub-questions.
2. Thoroughly analyze all "Assessed Research Evidence".
   * Identify key findings, arguments, and data points from each piece of evidence.
   * **Compare and contrast** information from different sources. Look for corroboration, discrepancies, or complementary perspectives.
   * **Synthesize** these diverse pieces of information into a cohesive narrative or argument. Don't just list summaries; build connections.
   * Identify overarching **themes or patterns** that emerge from the collective evidence.
   * If the evidence allows, discuss **nuances or implications** of the findings.
3. Construct a single, comprehensive, and analytical answer with extensive use of markdown formatting:
   * Use **bold** and *italic* text for emphasis on key concepts, findings, and terms
   * Create hierarchical structure with multiple levels of headings (# Main Heading, ## Subheading, ### Sub-subheading)
   * Utilize bullet points and numbered lists for organized presentation of findings, arguments, or evidence
   * Include block quotes (>) for important direct quotes or key points from sources
   * Use tables for comparative information when appropriate
   * Apply code blocks for technical content or data representations if relevant
   * Consider horizontal rules (---) to separate major sections of your analysis
4. Make your response substantial in length and depth:
   * Include a brief introduction that frames the topic and outlines your approach
   * Develop multiple substantive sections exploring different aspects of the question
   * Provide a thorough analysis section that examines implications and significance
   * Include a detailed conclusion that synthesizes key insights
5. **Crucially, include citation links [📚](/lib/KEY) after any information, claim, or finding that is directly supported by a specific piece of evidence.** Use the 'CitationKey' provided in the "Assessed Research Evidence" (e.g., from 'Assessed Item CitationKey: KEY_VALUE') to format the link: [📚](/lib/KEY_VALUE). Cite generously and accurately. Every substantive claim drawn from the evidence should be cited.
6. If the "Assessed Research Evidence" is insufficient to fully answer a part of the question, or if it lacks the necessary detail for a deep analysis of a particular point, you MUST clearly state this limitation (e.g., "The provided evidence does not offer detailed information on X..."). Do not apologize; simply state the limitation based on the provided evidence.
7. The final answer should be substantial, comprehensive, and reflect a detailed examination and analytical synthesis of the provided research. Avoid superficial responses.
8. IMPORTANT: Do NOT wrap your entire response in triple backticks (\`\`\`). Use markdown formatting within your text, but never enclose the whole response in code blocks.

Generate the detailed, analytical answer with citations now, making extensive use of markdown formatting to enhance readability and structure. Ensure the output is a single block of text representing the answer.`;

			try {
				const { object: agent3OutputObject } = await generateObject({
					model: models.largeModel,
					schema: FinalAnswerSchema,
					system: `${systemPrompt}\n\n${agent3SystemPrompt}`,
					messages: currentMessages,
					providerOptions: {
						openai: { reasoningEffort: "low" },
						google: {
							thinkingConfig: {
								thinkingBudget: 0,
							},
						},
					},
					temperature: 1,
				});
				const agent3OutputText =
					agent3OutputObject.analytical_answer_text;

				writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) + "Synthesizing answer..."
				}
			});

				const agent4SystemPrompt = `You are a meticulous formatting assistant. Your primary task is to ensure all citations in the provided text strictly follow the format: [📚](/lib/CITATION_KEY) while preserving all markdown formatting.\nYou will be given a text generated by another AI. Review it ONLY for citation formatting.\n
Original Answer Text:\n"""\n${agent3OutputText}\n"""\n
Your Task:\n
1. Scan the text for any citation attempts.
2. Ensure every citation perfectly matches the format: \`[📚](/lib/KEY)\` where KEY is the alphanumeric citation key.
   * Correct any deviations: e.g., extra spaces, missing brackets, incorrect symbols, different link structure.
   * Example: If you see \`[Source: KEY]\`, it should become \`[📚](/lib/KEY)\`. If you see \`[📚] (/lib/KEY)\`, remove the space.
   * IMPORTANT: Check for and fix mismatched brackets. For example, if you see \`[📚](/lib/KEY]\` (with a square bracket at the end instead of a parenthesis), correct it to \`[📚](/lib/KEY)\`.
   * Ensure all citations use the proper markdown link format with square brackets followed by parentheses: \`[text](url)\`, never \`[text](url]\` or \`[text][url]\` or any other variation.
3. IMPORTANT: Split any citations that contain multiple keys. For example:
   * If you see \`[📚](/lib/KEY1, KEY2)\` or \`[📚](/lib/KEY1,KEY2)\`, split it into two separate citations: \`[📚](/lib/KEY1) [📚](/lib/KEY2)\`
   * If you see any other format with multiple keys, always separate them into individual citations with the correct format
4. Do NOT change any other content, wording, or structure of the text.
5. Do NOT add or remove citations. Only correct the format of existing ones and split multiple-key citations.
6. PRESERVE ALL MARKDOWN FORMATTING including:
   * All headings (# Main Heading, ## Subheading, etc.)
   * Bold (**text**) and italic (*text*) formatting
   * Bullet points and numbered lists
   * Block quotes (> quoted text)
   * Tables and their formatting
   * Code blocks and their formatting
   * Horizontal rules (---)
7. If no citations are present or all are already correct, return the text as is.
8. IMPORTANT: Do NOT wrap your entire response in triple backticks (\`\`\`). Return the formatted text directly without enclosing it in code blocks.

Output the entire text with ONLY the citation formats corrected, ensuring all markdown formatting is preserved exactly as in the original.`;

				const stream = streamText({
					model: models.smallModel,
					providerOptions: {
						google: { thinkingConfig: { thinkingBudget: 0 } },
						openai: { reasoningEffort: "low" },
					},
					system: agent4SystemPrompt,
					messages: [
						{
							role: "user",
							content:
								"Please review and correct citation formats in the text provided in your instructions.",
						},
					],
					temperature: 1,
					onFinish: (response) => {
						writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
								"Answer synthesis complete."
				}
			});
					},
				});

				writer.merge(stream.toUIMessageStream());
			} catch (error) {
				console.error(
					"Error in Agent 3 (Pro) or Agent 4 (Flash) workflow:",
					error
				);
				writer.write({
				type: "data-status",
				id: generateId(),
				data: {
					type: "event",
					message: getTimeDuration(startTime) +
						"Error during answer synthesis or formatting."
				}
			});
				throw new Error(
					"The AI encountered an issue while generating or formatting the final answer."
				);
			}
		},
	});
}
