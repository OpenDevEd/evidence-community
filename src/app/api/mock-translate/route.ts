import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

// shortcut: mock only — one model call per results page, cached in this process; the real version stores translations per record and language.
const cache = new Map<string, Translation>();

type Translation = { title: string; abstract: string; source: string; same: boolean };

const bodySchema = z.object({
	target: z.string().min(2).max(5),
	items: z
		.array(z.object({ key: z.string(), title: z.string(), abstract: z.string() }))
		.max(30),
});

const LANGUAGE_NAMES: Record<string, string> = {
	en: "English",
	de: "German",
	ar: "Arabic",
	hi: "Hindi",
	fr: "French",
	zh: "Simplified Chinese",
	sw: "Swahili",
	pt: "Portuguese",
};

export async function POST(request: NextRequest) {
	const { target, items } = bodySchema.parse(await request.json());
	const missing = items.filter(({ key }) => !cache.has(`${target}:${key}`));

	if (missing.length > 0) {
		const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model: "google/gemini-3.7-flash",
				response_format: { type: "json_object" },
				messages: [
					{
						role: "system",
						content: `Translate each research record's title and abstract into ${LANGUAGE_NAMES[target] ?? target}. Keep names, acronyms and numbers. Reply with JSON {"items":[{"key","title","abstract","source","same"}]}: source is the ISO 639-1 code of the original language, same is true when the record is already in the target language (then copy title and abstract unchanged).`,
					},
					{
						role: "user",
						content: JSON.stringify(
							missing.map(({ key, title, abstract }) => ({ key, title, abstract: abstract.slice(0, 1200) })),
						),
					},
				],
			}),
		});
		const body = await response.text();
		if (!response.ok) {
			return NextResponse.json({ error: `Translation failed: ${response.status} ${body.slice(0, 300)}` }, { status: 502 });
		}
		const content = JSON.parse(body).choices?.[0]?.message?.content ?? "{}";
		for (const item of (JSON.parse(content).items ?? []) as Array<Translation & { key: string }>) {
			cache.set(`${target}:${item.key}`, {
				title: item.title,
				abstract: item.abstract,
				source: item.source,
				same: item.same,
			});
		}
	}

	return NextResponse.json({
		translations: Object.fromEntries(
			items.flatMap(({ key }) => {
				const translation = cache.get(`${target}:${key}`);
				return translation ? [[key, translation]] : [];
			}),
		),
	});
}
