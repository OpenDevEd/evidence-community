import { getRuntimeRequestLocale } from "@/i18n/server";
import { getCachedItem } from "../../cache";
import { NextResponse } from "next/server";
import { isAIAllowed } from "@/lib/utils";
import { convertToModelMessages } from "ai";
import { getAnswerFromPdfAgentic } from "./questions";
import { getAnswerFromSearchAgentic } from "./search";
import { quickChat } from "./quick";
import { Item } from "../../item/types";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	isLibraryFeatureEnabled,
	type LibraryFeatureId,
} from "@/config/library-config/features";
import {
	AIProviderUnavailableError,
	getAIProviderForConfig,
} from "@/lib/ai-provider";
import { getAISystemPrompt } from "@/lib/ai-prompts";

export const maxDuration = 240;

export async function POST(req: Request) {
	const {
		distinctId,
		messages,
		key,
		provider,
		smartScreeningFields,
		mode,
	} = await req.json();
	const locale = await getRuntimeRequestLocale(req);
	const config = await getLibraryConfig();
	const requiredFeature: LibraryFeatureId = key
		? "ai"
		: mode === "quick"
			? "aiSearch"
			: "deepResearch";
	if (!isLibraryFeatureEnabled(config.features, requiredFeature)) {
		return new NextResponse(`${requiredFeature} is disabled`, {
			status: 403,
		});
	}
	if (!key && !config.search.embeddings) {
		return new NextResponse("Semantic search is disabled", {
			status: 403,
		});
	}
	if (key && mode !== "quick" && !config.search.embeddings) {
		return new NextResponse(
			"PDF research requires semantic search",
			{ status: 403 },
		);
	}

	let item = null;
	if (key) {
		item = await getCachedItem(key);
		if (!item || !item.item) {
			return new NextResponse("Item not found", { status: 404 });
		}
	}

	let models;
	try {
		models = await getAIProviderForConfig(config, provider);
	} catch (error) {
		if (error instanceof AIProviderUnavailableError) {
			return new NextResponse(error.message, { status: 404 });
		}
		throw error;
	}

	const fullTextPDFs = item?.item?.fullTextPDFs;
	const cleanItem = item?.item ? { ...item.item, fullTextPDFs: undefined } : null;
	if (cleanItem && !isAIAllowed(cleanItem)) {
		return new NextResponse("AI not allowed", { status: 403 });
	}

	const modelMessages = await convertToModelMessages(messages.slice(1));
	const coreMessages = modelMessages.filter(
		(message) => message.content.length > 0
	);
	const systemPrompt = getAISystemPrompt(config, "chat", {
		hasPdf: Boolean(fullTextPDFs?.length),
		locale,
	});

	if (mode === "quick") {
		return quickChat(
			req,
			config,
			models,
			systemPrompt,
			locale,
			cleanItem as Item,
			coreMessages,
			fullTextPDFs,
			distinctId,
			messages,
		);
	}

	try {
		const response = cleanItem
			? await getAnswerFromPdfAgentic(
					config,
					models,
					systemPrompt,
					messages.at(-1)?.content || "",
					cleanItem?.key || null,
					coreMessages,
				)
			: await getAnswerFromSearchAgentic(
					config,
					models,
					systemPrompt,
					messages.at(-1)?.content || "",
					coreMessages,
					locale,
				);
		return response;
	} catch (error) {
		return new NextResponse("An error occurred while generating the answer.", { status: 500 });
	}
}
