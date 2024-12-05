import { NextResponse } from "next/server";
import OpenAI from "openai";
import config from "@/constants/config.json";

export async function POST(req: Request) {
	const { searchParams } = new URL(req.url);
	const prompt = searchParams.get("prompt") || "summarize";
	const systemPrompt = config.prompts[prompt as keyof typeof config.prompts];

	if (!systemPrompt || prompt === "chat") {
		return new NextResponse("Invalid prompt", { status: 400 });
	}

	const openai = new OpenAI({
		apiKey: process.env.OPENAI_API_KEY,
	});
	
	const data = await req.json();

	const completion = await openai.chat.completions.create({
		messages: [
			{ role: "system", content: systemPrompt },
			{ role: "user", content: JSON.stringify(data) },
		],
		model: process.env.OPENAI_MODEL as any,
		stream: true,
	});

	const stream = new ReadableStream({
		async start(controller) {
			const encoder = new TextEncoder();
			try {
				for await (const chunk of completion) {
					const content = chunk.choices[0]?.delta?.content;
					if (content) {
						const text = encoder.encode(content);
						controller.enqueue(text);
					}
				}
			} catch (err) {
				controller.error(err);
			} finally {
				controller.close();
			}
		},
	});

	return new NextResponse(stream);
}
