import "server-only";

import posthogClient from "@/lib/posthog";
import type { AIModelId } from "./models";
import type { AIErrorCode } from "./errors";

type TokenUsage = {
	inputTokens?: number;
	inputTokenDetails?: {
		noCacheTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	outputTokens?: number;
	totalTokens?: number;
};

type TrackAIUsageOptions = {
	feature: string;
	modelId: AIModelId;
	distinctId?: string;
	startedAt: number;
	success: boolean;
	usage?: TokenUsage;
	providerMetadata?: unknown;
	responseHeaders?:
		Record<string, string> | Array<Record<string, string> | undefined>;
	toolCounts?: Record<string, number>;
	errorCode?: AIErrorCode;
};

function headerValue(
	headers: Record<string, string> | undefined,
	name: string,
) {
	if (!headers) return null;
	const entry = Object.entries(headers).find(
		([key]) => key.toLowerCase() === name.toLowerCase(),
	);
	return entry?.[1] ?? null;
}

function responseHeaderValues(
	headers:
		| Record<string, string>
		| Array<Record<string, string> | undefined>
		| undefined,
	name: string,
) {
	const values = (Array.isArray(headers) ? headers : [headers])
		.map((value) => headerValue(value, name))
		.filter((value): value is string => value !== null);
	return values;
}

function getOpenRouterCost(providerMetadata: unknown): number | null {
	if (Array.isArray(providerMetadata)) {
		const costs = providerMetadata
			.map(getOpenRouterCost)
			.filter((cost): cost is number => cost !== null);
		return costs.length
			? costs.reduce((total, cost) => total + cost, 0)
			: null;
	}
	if (!providerMetadata || typeof providerMetadata !== "object") return null;
	const openrouter = Reflect.get(providerMetadata, "openrouter");
	if (!openrouter || typeof openrouter !== "object") return null;
	const usage = Reflect.get(openrouter, "usage");
	if (!usage || typeof usage !== "object") return null;
	const cost = Reflect.get(usage, "cost");
	return typeof cost === "number" && Number.isFinite(cost) ? cost : null;
}

export function trackAIUsage({
	feature,
	modelId,
	distinctId,
	startedAt,
	success,
	usage,
	providerMetadata,
	responseHeaders,
	toolCounts = {},
	errorCode,
}: TrackAIUsageOptions) {
	try {
		const cacheStatuses = responseHeaderValues(
			responseHeaders,
			"x-openrouter-cache-status",
		);
		const cacheAges = responseHeaderValues(
			responseHeaders,
			"x-openrouter-cache-age",
		).map(Number);
		const generationIds = responseHeaderValues(
			responseHeaders,
			"x-generation-id",
		);
		posthogClient.capture({
			event: "ai_request",
			distinctId: distinctId || "anonymous-ai-user",
			properties: {
				feature,
				model: modelId,
				input_tokens: usage?.inputTokens ?? null,
				uncached_input_tokens:
					usage?.inputTokenDetails?.noCacheTokens ?? null,
				cache_read_tokens:
					usage?.inputTokenDetails?.cacheReadTokens ?? null,
				cache_write_tokens:
					usage?.inputTokenDetails?.cacheWriteTokens ?? null,
				output_tokens: usage?.outputTokens ?? null,
				total_tokens: usage?.totalTokens ?? null,
				cost_usd: getOpenRouterCost(providerMetadata),
				response_cache_statuses: cacheStatuses,
				response_cache_hits: cacheStatuses.filter(
					(status) => status.toUpperCase() === "HIT",
				).length,
				response_cache_ages_seconds: cacheAges.filter(Number.isFinite),
				openrouter_generation_ids: generationIds,
				duration_ms: Date.now() - startedAt,
				tool_counts: toolCounts,
				success,
				error_code: errorCode ?? null,
			},
		});
	} catch (error) {
		console.error("Failed to record AI usage metadata", error);
	}
}
