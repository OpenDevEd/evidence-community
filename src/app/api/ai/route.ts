import { NextResponse } from "next/server";
import config from "@/constants/config.json";
import { getCachedItem } from "../cache";
import { streamText } from 'ai';
import { getModel } from "@/lib/ai";

export async function POST(req: Request) {
	const { searchParams } = new URL(req.url);
	const prompt = searchParams.get("prompt") || "summarize";
	const locale = req.headers.get("Accept-Language") || "en";
	const systemPrompt = config.prompts[prompt as keyof typeof config.prompts]?.join("\n");
	const { prompt: key, modelIndex } = await req.json();

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

	console.log("Now using", {
		modelName,
	});

	const result = streamText({
		model: provider!(modelName!),
		system: systemPrompt + `\n\nLanguage: ${locale}`,
		prompt: JSON.stringify(item),
	});

	return result.toDataStreamResponse({});
}
