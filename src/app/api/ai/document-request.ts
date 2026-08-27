import "server-only";

import { NextResponse } from "next/server";

import { isLibraryFeatureEnabled } from "@/config/library-config/features";
import { getLibraryConfig } from "@/config/library-config/server";
import {
	AIProviderUnavailableError,
	getAIProviderForConfig,
} from "@/lib/ai-provider";
import { isAIAllowed } from "@/lib/utils";
import { getCachedItem } from "../cache";

export async function prepareDocumentAIRequest(
	key: unknown,
	provider: unknown,
) {
	const libraryConfig = await getLibraryConfig();
	if (!isLibraryFeatureEnabled(libraryConfig.features, "ai")) {
		return {
			response: new NextResponse("AI is disabled", { status: 403 }),
		};
	}

	const item =
		typeof key === "string" && key ? await getCachedItem(key) : null;
	if (!item?.item) {
		return {
			response: new NextResponse("Item not found", { status: 404 }),
		};
	}

	let models;
	try {
		models = await getAIProviderForConfig(libraryConfig, provider);
	} catch (error) {
		if (error instanceof AIProviderUnavailableError) {
			return {
				response: new NextResponse(error.message, { status: 404 }),
			};
		}
		throw error;
	}

	const { fullTextPDFs, ...cleanItem } = item.item;
	if (!isAIAllowed(cleanItem)) {
		return {
			response: new NextResponse("AI not allowed", { status: 403 }),
		};
	}

	return {
		cleanItem,
		fullTextPDFs,
		libraryConfig,
		models,
	};
}
