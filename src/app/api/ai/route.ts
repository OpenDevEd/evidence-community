import { NextResponse } from "next/server";
import config from "@/constants/config.json";
import { getCachedItem } from "../cache";
import { streamText } from 'ai';
import { model, provider } from "./model";
import { openai } from "@ai-sdk/openai";

export async function POST(req: Request) {
	const { searchParams } = new URL(req.url);
	const prompt = searchParams.get("prompt") || "summarize";
	const locale = req.headers.get("Accept-Language") || "en";
	const systemPrompt = config.prompts[prompt as keyof typeof config.prompts]?.join("\n");
	const { prompt: key } = await req.json();

	if (!systemPrompt || prompt === "chat") {
		return new NextResponse("Invalid prompt", { status: 400 });
	}

	const item = await getCachedItem(key!);

	if (!item) {
		return new NextResponse("Item not found", { status: 404 });
	}

	const result = streamText({
		model: provider(model as any),
		system: systemPrompt + `\n\nLanguage: ${locale}`,
		prompt: JSON.stringify(item),
	});

	return result.toDataStreamResponse({});
}
