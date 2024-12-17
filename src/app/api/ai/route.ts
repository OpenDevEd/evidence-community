import { NextResponse } from "next/server";
import config from "@/constants/config.json";
import { getCachedItem } from "../cache";
import { generateText, streamText } from 'ai';
import { getModel, trackUsage } from "@/lib/ai";

export const maxDuration = 60;

export async function POST(req: Request) {
	const { searchParams } = new URL(req.url);
	const prompt = searchParams.get("prompt") || "summarize";
	const locale = req.headers.get("Accept-Language") || "en";
	const systemPrompt = config.prompts[prompt as keyof typeof config.prompts]?.join("\n")
	const proofReaderPrompt = config.proofreader?.join("\n")
	const sharedRules = config.shared_rules.join("\n")
	const pdfRules = config.pdf_rules.join("\n")
	const { prompt: key, modelIndex, distinctId } = await req.json();

	if (!systemPrompt || prompt === "chat") {
		return new NextResponse("Invalid prompt", { status: 400 });
	}

	const item = await getCachedItem(key!);

	if (!item) {
		return new NextResponse("Item not found", { status: 404 });
	}

	const { provider, modelName, error } = getModel(modelIndex);

	if (error) {
		return new NextResponse(error, { status: 404 });
	}

	const result = streamText({
		model: provider!(modelName!),
		system: [
			`LOCALE: ${locale}\n`,
			systemPrompt,
			sharedRules,
			item?.item?.attachmentsData?.[0]?.fullTextPDF?.[0] ? pdfRules : "",
		].join("\n"),
		prompt: JSON.stringify(item),
		onFinish(event) {
			trackUsage("ai_" + prompt, event, distinctId, prompt);
		},
	})

	return result.toDataStreamResponse({
		headers: {
			'Content-Type': 'text/event-stream',
		},
	})

}
