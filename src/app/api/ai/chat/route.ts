import { routing } from "@/i18n/routing";
import { getCachedItem } from "../../cache";
import { NextResponse } from "next/server";
import { createResource, findRelevantContent, getModel, RAGResult } from "@/lib/ai";
import { isAIAllowed } from "@/lib/utils";
import { convertToCoreMessages } from "ai";
import { getAnswerFromPdfAgentic } from "./questions";
import { getAnswerFromSearchAgentic } from "./search";
import { quickChat } from "./quick";
import { Item } from "../../item/types";

export const maxDuration = 240;

const EmbeddedItems = new Set<string>();

export async function POST(req: Request) {
	const { distinctId, messages, key, modelIndex, smartScreeningFields, mode } = await req.json();
	const locale = req.headers.get("Accept-Language") || routing.defaultLocale;

	let item = null;
	if (key) {
		item = await getCachedItem(key);
		if (!item || !item.item) {
			return new NextResponse("Item not found", { status: 404 });
		}

		for (const pdf of item.item.fullTextPDFs || []) {
			if (!EmbeddedItems.has(pdf.key)) {
				console.log("Creating resource for", pdf.key);
				await createResource(pdf, key);
				console.log("Resource created for", pdf.key);
				EmbeddedItems.add(pdf.key);
			}
		}
	}

	const { provider, modelName, error, largeModel, smallModel } = getModel(modelIndex);
	if (error || !provider || !modelName) {
		return new NextResponse(error, { status: 404 });
	}

	const fullTextPDFs = item?.item?.fullTextPDFs;
	const cleanItem = item?.item ? { ...item.item, fullTextPDFs: undefined } : null;
	if (cleanItem && !isAIAllowed(cleanItem)) {
		return new NextResponse("AI not allowed", { status: 403 });
	}

	const coreMessages = convertToCoreMessages(messages.slice(1)).filter(
		(message) => message.content.length > 0
	);

	if (mode === "quick") {
		return quickChat(req, provider, modelName, locale, cleanItem as Item, coreMessages, fullTextPDFs, distinctId, messages);
	}

	try {
		const response = cleanItem ? await getAnswerFromPdfAgentic(provider, modelName, largeModel, smallModel, messages.at(-1)?.content || "", cleanItem?.key || null, coreMessages) : await getAnswerFromSearchAgentic(provider, modelName, largeModel, smallModel, messages.at(-1)?.content || "", coreMessages, locale);
		console.log("Response:", response);
		return response;
	} catch (error) {
		console.error("Error in getAnswerFromPdfAgentic:", error);
		return new NextResponse("An error occurred while generating the answer.", { status: 500 });
	}
}