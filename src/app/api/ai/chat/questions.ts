import {
    generateObject,
    streamText,
    generateId,
    createUIMessageStream,
    createUIMessageStreamResponse,
    ModelMessage
} from "ai";
import { findRelevantContent, RAGResult } from "@/lib/ai";
import { z } from "zod";
import { getTimeDuration } from "@/lib/utils";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import type { ResolvedAIModels } from "@/lib/ai-provider";

const Agent0Schema = z.object({
    inferred_page: z.number().int().default(0)
        .describe("The page number explicitly mentioned or clearly implied for the current user question. 0 if no specific page is targeted."),
});
type Agent0Response = z.infer<typeof Agent0Schema>;

const Agent1Schema = z.object({
    original_question: z.string()
        .describe("The user's most recent question that needs to be addressed."),
    sub_questions: z.array(z.string()).default([])
        .describe("A list of simpler sub-questions if the original question is complex. Empty if straightforward."),
    search_queries: z.array(
        z.object({
            for_question: z.string().describe("The original or sub-question this search query pertains to."),
            query: z.string().describe("A concise search query/keywords for finding relevant information."),
        })
    ).default([])
        .describe("A list of search queries to find information for the original/sub-questions."),
});
type Agent1Response = z.infer<typeof Agent1Schema>;

interface RetrievedContentGroup {
    question_context: string;
    document_extracts: string[];
}

export async function getAnswerFromPdfAgentic(
    config: LibraryServerConfig,
    models: ResolvedAIModels,
    systemPrompt: string,
    userQuestion: string,
    itemKey: string | null,
    messagesHistory: ModelMessage[],
) {

    const stream = createUIMessageStream({
        execute: async ({ writer }) => {
            const startTime = Date.now();

            writer.write({
                type: "data-status",
                id: generateId(),
                data: {
                    type: "event",
                    message: getTimeDuration(startTime) + "Starting PDF analysis workflow...",
                }
            });

            if (!itemKey) {
                throw new Error("ItemKey is required to search for an answer.");
            }

            const currentMessages: ModelMessage[] = [
                ...messagesHistory,
                { role: 'user', content: userQuestion }
            ];


            let inferredPage: number = 0;
            try {
                writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Analyzing question for page references...",
                    }
                });

                const agent0SystemPrompt = `You are an AI assistant that specializes in identifying page numbers from user queries and conversation history.
  Analyze the most recent user message in the provided conversation. If relevant, also consider the immediately preceding turn.
  Is the user explicitly referring to a specific page number in the document for their current question?
  - Look for explicit mentions like "on page X", "page number Y", "referring to page Z", "what does page 12 say".
  - If a page number is explicitly mentioned, extract the integer value.
  - If not in the current question, but the *immediately preceding user message* in the history asked about a page, and the current question is a direct follow-up, consider that page.
  - If multiple page numbers are mentioned, use the first one.
  - If no page number is explicitly mentioned or clearly implied, output 0.
  You must output an object that conforms to the provided schema.`;

                const { object: pageInferenceResponse } = await generateObject({
                    model: models.smallModel,
                    providerOptions: {
                        google: {
                            thinkingConfig: {
                                thinkingBudget: 0,
                            },
                        },
                        openai: {
                            reasoningEffort: "low",
                        }
                    },
                    temperature: 1,
                    schema: Agent0Schema,
                    system: agent0SystemPrompt,
                    messages: currentMessages,
                });
                inferredPage = pageInferenceResponse.inferred_page;

                if (inferredPage > 0) {
                writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + `Found reference to page ${inferredPage}`,
                    }
                });
                }
            } catch (error) {
                console.error("Error in Agent 0 (Page Inference - Flash):", error);
                writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Error analyzing page references.",
                
                    }
                });

            }


            let plan: Agent1Response;
            try {
                writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Analyzing question and planning search strategy...",
                
                    }
                });

                const agent1SystemPrompt = `You are a helpful AI assistant with excellent conversational skills. Your task is to analyze the user's most recent question about a document in the context of the entire conversation history, and prepare it for information retrieval.

First, carefully analyze the entire conversation history to understand the context. If the user's most recent message:
1. References previous topics with pronouns or implicit references (e.g., "Tell me more about this" or "What about the conclusion?")
2. Builds on previously discussed subjects without explicitly naming them
3. Uses shorthand or abbreviated references to previously mentioned concepts

Then generate a new, explicit "original_question" that incorporates the full context. This should be a complete, standalone question that someone without access to the conversation history would understand.

For example:
- If previous messages discussed "climate change impacts" and the user asks "What solutions does it propose?", the original_question should be "What solutions does the document propose for addressing climate change impacts?"
- If the conversation was about "teaching methods" and the user asks "Which one is most effective?", the original_question should be "Which teaching method described in the document is most effective?"

The user's most recent question is: "${userQuestion}". This must be the basis for your 'original_question' in your output, expanded with context as needed.
${inferredPage > 0 ? `The user seems to be interested in page ${inferredPage}. Keep this in mind if it's relevant for query formulation, but primarily focus on the question's content.` : ''}
  
Based on this contextual understanding:
1. Set the 'original_question' field to your expanded, context-aware version of the user's most recent question.
2. Identify if the question is complex and can be broken down into simpler sub-questions. If so, list them in the sub_questions array. If not, the sub_questions array should be empty.
3. For the main question (and each sub-question, if any), generate 1-2 concise search queries or sets of keywords that would be effective for finding relevant information in a text document.

You must output an object that conforms to the provided schema.`;

                const { object: parsedPlan } = await generateObject({
                    model: models.smallModel,
                    providerOptions: {
                        google: {
                            thinkingConfig: {
                                thinkingBudget: 0,
                            },
                        },
                        openai: {
                            reasoningEffort: "low",
                        }
                    },
                    schema: Agent1Schema,
                    system: agent1SystemPrompt,
                    messages: currentMessages,
                    temperature: 1,
                });
                plan = parsedPlan;
                if (!plan.original_question && userQuestion) {
                    plan.original_question = userQuestion;
                }

                writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + `Generated ${plan.search_queries.length} search queries${plan.sub_questions.length > 0 ? ` and identified ${plan.sub_questions.length} sub-questions` : ''}`,
                    }
                });

            } catch (error) {
                console.error("Error in Agent 1 (Flash):", error);
                writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Error during question analysis. Using simplified search approach.",
                
                    }
                });
                plan = {
                    original_question: userQuestion,
                    sub_questions: [],
                    search_queries: [{ for_question: userQuestion, query: userQuestion }],
                };
            }


            writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Searching through document content...",
            
                    }
                });

            const retrievedContentGroups: RetrievedContentGroup[] = [];
            const MAX_EXTRACTS_PER_QUERY = 7;

            for (const searchQueryInstruction of plan.search_queries) {
                try {
                    writer.write({
                        type: "data-status",
                        id: generateId(),
                        data: {
                            type: "event",
                            message: getTimeDuration(startTime) + `Searching for: ${searchQueryInstruction.query}`,
                        }
                    });

                    const ragResults: RAGResult[] = await findRelevantContent(
                        config,
                        searchQueryInstruction.query,
                        itemKey,
                        inferredPage,
                    );

                    const extractsForThisQuery = ragResults
                        .slice(0, MAX_EXTRACTS_PER_QUERY)
                        .map((entry) => entry.name);

                    if (extractsForThisQuery.length > 0) {
                        retrievedContentGroups.push({
                            question_context: searchQueryInstruction.for_question,
                            document_extracts: extractsForThisQuery,
                        });

                        writer.write({
                            type: "data-status",
                            id: generateId(),
                            data: {
                                type: "event",
                                message: getTimeDuration(startTime) + `Found ${extractsForThisQuery.length} relevant passages`,
                            }
                        });
                    } else {
                        writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "No relevant content found for this query",
                        
                    }
                });
                    }
                } catch (ragError) {
                    console.error(`Error calling findRelevantContent for query "${searchQueryInstruction.query}":`, ragError);
                    writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Error searching document content",
                    
                    }
                });
                }
            }


            let documentContextForAI = "";
            if (retrievedContentGroups.length > 0) {
                documentContextForAI = retrievedContentGroups
                    .map(
                        (group) =>
                            `Context for "${group.question_context.replace(/"/g, '\\"')}":\n` +
                            group.document_extracts
                                .map((extract, i) => `Extract ${i + 1}: "${extract.replace(/"/g, '\\"')}"`)
                                .join("\n")
                    )
                    .join("\n\n---\n\n");
            } else {
                documentContextForAI = `No specific information was found in the document for the generated search queries ${inferredPage > 0 ? `(specifically looking around page ${inferredPage})` : '(searching across the document)'}. The document might not contain the requested information, or the information could not be precisely located.`;
            }


            writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Analyzing findings and composing detailed answer...",
            
                    }
                });

            const subQuestionsContext =
                plan.sub_questions && plan.sub_questions.length > 0
                    ? `The user's question appears to have these underlying aspects or sub-questions that should be addressed:\n${plan.sub_questions
                        .map((sq) => `- ${sq}`)
                        .join("\n")}`
                    : "The user's question should be addressed directly and comprehensively.";

            const agent3SystemPrompt = `You are an expert AI research assistant. Your primary function is to provide highly detailed, analytical, and insightful answers based *exclusively* on the provided "Document Excerpts".
  You must not use any external knowledge or make assumptions beyond what is present in the excerpts.
  Your response to the user should be a direct, coherent, and well-structured answer. Do NOT mention "excerpts," "provided text," "document extracts," or the process of information retrieval in your answer. Act as if you have an intrinsic understanding of the relevant parts of the document.
  
  User's Original Question: "${plan.original_question.replace(/"/g, '\\"')}"
  ${inferredPage > 0 ? `(The user's query may have a focus around page ${inferredPage} of the document.)` : ''}
  ${subQuestionsContext}
  
  --- Document Excerpts ---
  ${documentContextForAI}
  --- End of Document Excerpts ---
  
  Your Task:
  1. Deeply understand the User's Original Question and any identified sub-aspects.
  2. Thoroughly analyze all "Document Excerpts." Identify key information, connections between different pieces of information, and any underlying themes or arguments relevant to the user's question.
  3. Synthesize this information into a single, cohesive, and comprehensive answer. Your answer should be significantly more than a simple summary; it should demonstrate exceptional analytical depth and comprehensive coverage.
     - Explain concepts clearly with detailed examples where possible
     - Connect disparate pieces of information to form a holistic view
     - Draw out implications, nuances, and deeper insights from the text
     - Use precise language and technical terminology appropriate to the subject matter
     - Provide a thorough examination that explores multiple dimensions of the topic
  4. Structure your answer with extensive use of markdown formatting:
     - Use **bold** and *italic* text for emphasis
     - Create hierarchical structure with multiple levels of headings (# Main Heading, ## Subheading, ### Sub-subheading)
     - Utilize bullet points and numbered lists for organized presentation
     - Include block quotes (>) for important excerpts or key points
     - Use tables for comparative information when appropriate
     - Apply code blocks for technical content if relevant
     - Consider horizontal rules (---) to separate major sections
  5. Make your response substantial in length and depth:
     - Include a brief introduction that frames the topic
     - Develop multiple substantive sections exploring different aspects of the question
     - Provide a thorough analysis section that examines implications and significance
     - Include a detailed conclusion that synthesizes key insights
  6. If the "Document Excerpts" are insufficient to fully answer a part of the question, or if they lack the necessary detail for a deep analysis of a particular point, you must clearly state that the document (as per the provided excerpts) does not seem to contain the specific information or the depth required for that aspect. Do not apologize; simply state the limitation based on the provided document content.
  7. The final answer should be substantial, comprehensive, and reflect a detailed examination of the provided text. Avoid short, superficial responses.
  8. IMPORTANT: Do NOT wrap your entire response in triple backticks (\`\`\`). Use markdown formatting within your text, but never enclose the whole response in code blocks.
  
  Generate the detailed, analytical answer now, making extensive use of markdown formatting to enhance readability and structure.`;
            
            let finishedThinking = false;

            try {
                const result = streamText({
                    model: models.largeModel,
                    system: `${systemPrompt}\n\n${agent3SystemPrompt}`,
                    messages: currentMessages,
                    onChunk: (chunk) => {
                        if (!finishedThinking) {
                            writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: "Analyzing findings and composing detailed answer...",
                            
                    }
                });
                            finishedThinking = true;
                        }
                    },
                    temperature: 1,
                    onFinish: (response) => {
                        writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Answer synthesis complete.",
                        
                    }
                });
                    }
                });

                writer.merge(result.toUIMessageStream());
            } catch (error) {
                console.error("Error in Agent 3 (Pro) streaming:", error);
                writer.write({
                    type: "data-status",
                    id: generateId(),
                    data: {
                        type: "event",
                        message: getTimeDuration(startTime) + "Error generating the answer. Please try again.",
                
                    }
                });
                throw new Error("The AI encountered an issue while generating the detailed answer.");
            }
        }
    });

    return createUIMessageStreamResponse({ stream });
}
