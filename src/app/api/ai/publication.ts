import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getRuntimeRequestLocale } from "@/i18n/server";
import {
	AIProviderUnavailableError,
	getAIProviderForConfig,
} from "@/lib/ai-provider";
import { isAIAllowed } from "@/lib/utils";
import { NextResponse } from "next/server";
import { getCachedItem } from "../cache";

function failure(message: string, status: number) {
	return {
		ok: false as const,
		response: new NextResponse(message, { status }),
	};
}

function validItemKey(key: unknown): key is string {
	return typeof key === "string" && key.length > 0;
}

function optionalDistinctId(value: unknown) {
	if (typeof value === "string") return value;
	if (value === null) return null;
	return undefined;
}

function parseAIPublicationRequest(body: unknown) {
	if (!body || typeof body !== "object") {
		return { key: undefined, provider: undefined, distinctId: undefined };
	}
	return {
		key: Reflect.get(body, "prompt"),
		provider: Reflect.get(body, "provider"),
		distinctId: optionalDistinctId(Reflect.get(body, "distinctId")),
	};
}

async function loadItem(key: unknown) {
	if (!validItemKey(key)) {
		return failure("Invalid item key", 400);
	}
	const result = await getCachedItem(key);
	return result?.item
		? { ok: true as const, item: result.item }
		: failure("Item not found", 404);
}

async function loadModels(config: LibraryServerConfig, provider: unknown) {
	try {
		return {
			ok: true as const,
			models: await getAIProviderForConfig(config, provider),
		};
	} catch (error) {
		if (!(error instanceof AIProviderUnavailableError)) throw error;
		return failure(error.message, 404);
	}
}

export async function loadAIPublication(
	config: LibraryServerConfig,
	key: unknown,
	provider: unknown,
) {
	const startedAt = Date.now();
	const itemResult = await loadItem(key);
	if (!itemResult.ok) return itemResult;
	const modelResult = await loadModels(config, provider);
	if (!modelResult.ok) return modelResult;
	const { fullTextPDFs, ...item } = itemResult.item;
	if (!isAIAllowed(item)) {
		return failure("AI not allowed", 403);
	}

	return {
		ok: true as const,
		fullTextPDFs,
		item,
		models: modelResult.models,
		startedAt,
	};
}

export async function loadAIPublicationRequest(
	config: LibraryServerConfig,
	req: Request,
) {
	const locale = await getRuntimeRequestLocale(req);
	const { key, provider, distinctId } = parseAIPublicationRequest(
		await req.json(),
	);
	return {
		distinctId,
		locale,
		publication: await loadAIPublication(config, key, provider),
	};
}
