import config from "@/constants/config.json";
import {
	convertToCoreMessages,
	streamText
} from "ai";
import { getCachedItem } from "../../cache";
import { NextResponse } from "next/server";
import { model, provider } from "../model";

const systemPrompt = config.prompts.chat.join("\n");

export async function POST(req: Request) {
	const { id, messages, key } = await req.json();
	const locale = req.headers.get("Accept-Language") || "en";
	const item = await getCachedItem(key);

	if (!item) {
		return new NextResponse("Item not found", { status: 404 });
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
		model: provider(model as any),
		system: systemPrompt + `\n\nLanguage: ${locale}`,
		messages: coreMessages,
	});

	return result.toDataStreamResponse({});
}
