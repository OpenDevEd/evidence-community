import { NextResponse } from "next/server";
import config from "@/constants/config.json";
import { getCachedItem } from "../cache";
import { generateText, streamText } from 'ai';
import { getModel } from "@/lib/ai";
// import fs from "fs";

export async function POST(req: Request) {
	const { searchParams } = new URL(req.url);
	const prompt = searchParams.get("prompt") || "summarize";
	const locale = req.headers.get("Accept-Language") || "en";
	const systemPrompt = config.prompts[prompt as keyof typeof config.prompts]?.join("\n")
	const proofReaderPrompt = config.proofreader?.join("\n")
	const sharedCriticalRules = config.shared_critical_rules.join("\n")
	const { prompt: key, modelIndex } = await req.json();

	if (!systemPrompt || prompt === "chat") {
		return new NextResponse("Invalid prompt", { status: 400 });
	}

	const item = await getCachedItem(key!);

	// fs.writeFileSync("lastUsedItem.json", JSON.stringify(item, null, 2));

	if (!item) {
		return new NextResponse("Item not found", { status: 404 });
	}

	const { provider, modelName, error } = getModel(modelIndex);

	if (error) {
		return new NextResponse(error, { status: 404 });
	}

	// const result = await generateText({
	// 	model: provider!(modelName!),
	// 	system: [
	// 		`LOCALE: ${locale}\n`,
	// 		systemPrompt,
	// 		sharedCriticalRules,
	// 	].join("\n"),
	// 	prompt: JSON.stringify(item),
	// });

	// const proofReaderResult = streamText({
	// 	model: provider!(modelName!),
	// 	system: [
	// 		sharedCriticalRules,
	// 		proofReaderPrompt,
	// 	].join("\n"),
	// 	prompt: "1. Source Document: " + JSON.stringify(item) + "\n\n2. Report: " + result.text,
	// }) 

	// return proofReaderResult.toDataStreamResponse()

	const result = streamText({
		model: provider!(modelName!),
		system: [
			sharedCriticalRules,
			systemPrompt,
		].join("\n"),
		prompt: JSON.stringify(item),
	})

	return result.toDataStreamResponse({
		headers: {
			'Content-Type': 'text/event-stream',
		},
	})

}
