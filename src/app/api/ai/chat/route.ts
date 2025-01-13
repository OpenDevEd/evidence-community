import config from "@/constants/config.json";
import {
	convertToCoreMessages,
	streamText
} from "ai";
import { getCachedItem } from "../../cache";
import { NextResponse } from "next/server";
import { getModel, trackUsage } from "@/lib/ai";
import { routing } from "@/i18n/routing";

export async function POST(req: Request) {
	const { distinctId, messages, key, modelIndex } = await req.json();
	const locale = req.headers.get("Accept-Language") || routing.defaultLocale;
	const systemPrompt = config.prompts.chat.join("\n");
	const sharedRules = config.shared_rules.join("\n")
	const pdfRules = config.pdf_rules.join("\n")
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
		system: [
			`LOCALE: ${locale}\n`,
			systemPrompt,
			sharedRules,
			item?.item?.attachmentsData?.[0]?.fullTextPDF?.[0] ? pdfRules : "",
		].join("\n"),
		messages: coreMessages,
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
