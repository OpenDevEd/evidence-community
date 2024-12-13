import config from "@/constants/config.json";
import {
	convertToCoreMessages,
	streamText
} from "ai";
import { getCachedItem } from "../../cache";
import { NextResponse } from "next/server";
import { getModel } from "@/lib/ai";

const systemPrompt = config.prompts.chat.join("\n");

export async function POST(req: Request) {
	const { id, messages, key, modelIndex } = await req.json();
	const locale = req.headers.get("Accept-Language") || "en";
	const item = await getCachedItem(key);

	if (!item) {
		return new NextResponse("Item not found", { status: 404 });
	}

	const { provider, modelName, error } = getModel(modelIndex);

	if (error) {
		return new NextResponse(error, { status: 404 });
	}

	messages.unshift({
		role: "user",
		content: [
			{
				type: "text",
				text: "This is the data for the item, please use it to answer the user's question.",
			},
			{
				type: "text",
				text: item ? JSON.stringify(item) : undefined,
			},
		],
	});

	const coreMessages = convertToCoreMessages(messages).filter(
		(message) => message.content.length > 0
	);

	const result = streamText({
		model: provider!(modelName!),
		system: systemPrompt + `\n\nLanguage: ${locale}`,
		messages: coreMessages,
	});

	return result.toDataStreamResponse({});
}
