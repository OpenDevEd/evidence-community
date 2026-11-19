import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { textFingerprint } from "@/lib/text-fingerprint";

// shortcut: mock only — translations are kept in this process; the real version stores each one per record, part and language.
const titles = new Map<string, { title: string; source: string; same: boolean }>();
const abstracts = new Map<string, string>();

const bodySchema = z.discriminatedUnion("part", [
	z.object({
		part: z.literal("titles"),
		target: z.string().min(2).max(5),
		items: z.array(z.object({ key: z.string(), title: z.string() })).max(30),
	}),
	z.object({
		part: z.literal("abstracts"),
		target: z.string().min(2).max(5),
		items: z.array(z.object({ key: z.string(), abstract: z.string() })).max(10),
	}),
]);

/** Language, record and the fingerprint of the text translated, so an edited original is translated again. */
const id = (target: string, key: string, source: string) => `${target}:${key}:${textFingerprint(source)}`;

const languageName = (code: string) => new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;

async function translate<T>(system: string, payload: unknown): Promise<T> {
	const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
		method: "POST",
		headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
		body: JSON.stringify({
			model: "anthropic/claude-haiku-5.5",
			// Translation needs no reasoning.
			reasoning: { effort: "none" },
			response_format: { type: "json_object" },
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: JSON.stringify(payload) },
			],
		}),
	});
	const body = await response.text();
	if (!response.ok) throw new Error(`Translation failed: ${response.status} ${body.slice(0, 300)}`);
	const content: string = JSON.parse(body).choices?.[0]?.message?.content ?? "{}";
	return JSON.parse(content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1)) as T;
}

/** Titles for a whole page in one short call, so they arrive first; abstracts in batches the page sends side by side. */
export async function POST(request: NextRequest) {
	const body = bodySchema.parse(await request.json());
	const language = languageName(body.target);

	if (body.part === "titles") {
		const sourceOf = new Map(body.items.map(({ key, title }) => [key, title]));
		const missing = body.items.filter(({ key, title }) => !titles.has(id(body.target, key, title)));
		if (missing.length > 0) {
			const { items = [] } = await translate<{ items?: Array<{ key: string; title: string; source: string; same: boolean }> }>(
				`Translate each research record's title into ${language}. Keep names, acronyms and numbers. Reply with JSON {"items":[{"key","title","source","same"}]}: source is the ISO 639-1 code of the title's language, same is true when it is already in ${language} (then copy the title unchanged).`,
				missing,
			);
			for (const { key, title, source, same } of items) {
				if (sourceOf.has(key)) titles.set(id(body.target, key, sourceOf.get(key)!), { title, source, same });
			}
		}
		return NextResponse.json({
			titles: Object.fromEntries(
				body.items.flatMap(({ key, title }) => {
					const found = titles.get(id(body.target, key, title));
					return found ? [[key, found]] : [];
				}),
			),
		});
	}

	const sourceOf = new Map(body.items.map(({ key, abstract }) => [key, abstract]));
	const missing = body.items.filter(({ key, abstract }) => abstract && !abstracts.has(id(body.target, key, abstract)));
	if (missing.length > 0) {
		const { items = [] } = await translate<{ items?: Array<{ key: string; abstract: string }> }>(
			`Translate each research abstract into ${language}. Keep names, acronyms and numbers. If an abstract is already in ${language}, copy it unchanged. Reply with JSON {"items":[{"key","abstract"}]}.`,
			missing.map(({ key, abstract }) => ({ key, abstract: abstract.slice(0, 6000) })),
		);
		for (const { key, abstract } of items) {
			if (sourceOf.has(key)) abstracts.set(id(body.target, key, sourceOf.get(key)!), abstract);
		}
	}
	return NextResponse.json({
		abstracts: Object.fromEntries(
			body.items.flatMap(({ key, abstract }) => {
				const found = abstracts.get(id(body.target, key, abstract));
				return found ? [[key, found]] : [];
			}),
		),
	});
}
