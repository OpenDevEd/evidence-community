import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getLibraryConfig } from "@/config/library-config/server";
import { getAISystemPrompt } from "@/lib/ai-prompts";
import { trackAIUsage } from "@/lib/ai/telemetry";
import { streamText } from "ai";
import { NextResponse } from "next/server";
import type { Item } from "../item/types";
import {
	loadAIPublication,
	loadAIPublicationRequest,
} from "./publication";

export const maxDuration = 60;

type PublicationPrompt = "explain" | "summarize";

function publicationPrompt(req: Request): PublicationPrompt | null {
	const value = new URL(req.url).searchParams.get("prompt") ?? "summarize";
	if (value === "summarize" || value === "explain") return value;
	return null;
}

function itemWithFullText(
	item: Omit<Item, "fullTextPDFs">,
	fullTextPDFs: Item["fullTextPDFs"],
) {
	const attachments = item.attachmentsData ?? [];
	const documents = fullTextPDFs ?? [];
	return {
		...item,
		attachmentsData: attachments.map((attachment) => ({
			...attachment,
			fullTextPDF: documents.find(
				(document) => document.key === attachment.key,
			)?.fullTextPDF,
		})),
	};
}

function streamPublication(
	config: LibraryServerConfig,
	prompt: PublicationPrompt,
	locale: string,
	publication: Awaited<ReturnType<typeof loadAIPublication>> & { ok: true },
	distinctId: string | null | undefined,
) {
	const { fullTextPDFs, item, models, startedAt } = publication;
	const result = streamText({
		model: models.defaultModel,
		system: getAISystemPrompt(config, prompt, {
			hasPdf: Boolean(fullTextPDFs?.length),
			locale,
		}),
		prompt: JSON.stringify(itemWithFullText(item, fullTextPDFs)),
		temperature: 1,
		providerOptions: {
			openai: { reasoningEffort: "low" },
			google: { thinkingConfig: { thinkingBudget: 0 } },
		},
		async onFinish(event) {
			await trackAIUsage(config, {
				feature: prompt,
				modelId: models.defaultModelId,
				distinctId,
				startedAt,
				success: true,
				usage: event.usage,
				providerMetadata: event.providerMetadata,
			});
		},
	});

	return result.toTextStreamResponse({
		headers: { "Content-Type": "text/event-stream" },
	});
}

export async function POST(req: Request) {
	const config = await getLibraryConfig();
	if (!isLibraryFeatureEnabled(config.features, "ai")) {
		return new NextResponse("AI is disabled", { status: 403 });
	}
	const prompt = publicationPrompt(req);
	if (!prompt) return new NextResponse("Invalid prompt", { status: 400 });
	const { distinctId, locale, publication } =
		await loadAIPublicationRequest(config, req);
	if (!publication.ok) return publication.response;
	return streamPublication(config, prompt, locale, publication, distinctId);
}
