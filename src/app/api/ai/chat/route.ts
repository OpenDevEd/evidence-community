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

const EmbeddedItems = new Set<string>();

export async function POST(req: Request) {
	const { distinctId, messages, key, modelIndex } = await req.json();
	const locale = req.headers.get("Accept-Language") || routing.defaultLocale;
	const systemPrompt = config.prompts.chat.join("\n");
	const sharedRules = config.shared_rules.join("\n")
	const item = await getCachedItem(key);

	if (!item || !item.item) {
		return new NextResponse("Item not found", { status: 404 });
	}

	if (!EmbeddedItems.has(item.item.key)) {
		await createResource(item.item);
		EmbeddedItems.add(item.item.key);
	}

	console.log("created resource for item", item.item.key);

	const { provider, modelName, error } = getModel(modelIndex);

	if (error) {
		return new NextResponse(error, { status: 404 });
	}

	const {fullTextPDFs, ...cleanItem} = item.item;

	if (!isAIAllowed(cleanItem)) {
		return new NextResponse("AI not allowed", { status: 403 });
	}
	
	const coreMessages = convertToCoreMessages(messages).filter(
		(message) => message.content.length > 0
	);

	const result = streamText({
		model: provider!(modelName!),
		system: [
			`LOCALE: ${locale}\n`,
			"You are a helpful assistant that can answer questions about the item, if the user asks for information that is not present in your knowledge base, or references a page or a PDF, use the tools to get the information without asking for confirmation.",
			"Even if you think a question is not related to the item, use the tools to get the information without asking for confirmation, only then can you say that you don't know.",
			"Always use the tools to get the information without asking for confirmation, even if the information seems unlikely.",
			`ITEM: ${JSON.stringify(cleanItem)}\n`,
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
					userToolCallInformation: z.string().describe("Something to tell the user while the tool is being executed with ellipsises at the end."),
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
