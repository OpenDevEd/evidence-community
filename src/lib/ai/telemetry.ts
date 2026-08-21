import "server-only";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { getPostHogForConfig } from "@/lib/posthog";
import type { AIErrorCode } from "./errors";

/** The AI features a library can bill, count, and compare. */
export type AIFeature =
	| "summarize"
	| "explain"
	| "questions"
	| "chat"
	| "screening";

type TelemetryConfig = Pick<
	LibraryServerConfig,
	"analytics" | "revision" | "updatedAt"
>;

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

type ResponseHeaders =
	| Record<string, string>
	| Array<Record<string, string> | undefined>;

type TrackAIUsageOptions = {
	feature: AIFeature;
	modelId: string;
	distinctId?: string | null;
	startedAt: number;
	success: boolean;
	usage?: TokenUsage;
	providerMetadata?: unknown;
	responseHeaders?: ResponseHeaders;
	toolCounts?: Record<string, number>;
	errorCode?: AIErrorCode;
	now?: () => number;
};

function headerValues(headers: ResponseHeaders | undefined, name: string) {
	return (Array.isArray(headers) ? headers : [headers])
		.map((header) =>
			Object.entries(header ?? {}).find(
				([key]) => key.toLowerCase() === name.toLowerCase(),
			),
		)
		.map((entry) => entry?.[1])
		.filter((value): value is string => value !== undefined);
}

/**
 * The gateway reports what a request actually cost. Anything else (a direct
 * provider, or a provider that reports nothing) simply has no cost to record.
 */
function gatewayCost(providerMetadata: unknown): number | null {
	if (Array.isArray(providerMetadata)) {
		const costs = providerMetadata
			.map(gatewayCost)
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

/**
 * Records what an AI request cost and how it went. Metadata only: prompts,
 * chat contents, abstracts, search bodies, and PDF contents never leave the
 * server. Analytics failures never fail the work the user asked for.
 */
export async function trackAIUsage(
	config: TelemetryConfig,
	{
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
		now = Date.now,
	}: TrackAIUsageOptions,
) {
	if (!distinctId) return;

	try {
		const posthog = await getPostHogForConfig(config);
		if (!posthog) return;

		const cacheStatuses = headerValues(
			responseHeaders,
			"x-openrouter-cache-status",
		);

		posthog.capture({
			event: "ai_request",
			distinctId,
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
				cost_usd: gatewayCost(providerMetadata),
				response_cache_statuses: cacheStatuses,
				response_cache_hits: cacheStatuses.filter(
					(status) => status.toUpperCase() === "HIT",
				).length,
				response_cache_ages_seconds: headerValues(
					responseHeaders,
					"x-openrouter-cache-age",
				)
					.map(Number)
					.filter(Number.isFinite),
				generation_ids: headerValues(
					responseHeaders,
					"x-generation-id",
				),
				duration_ms: now() - startedAt,
				tool_counts: toolCounts,
				success,
				error_code: errorCode ?? null,
			},
		});
	} catch (error) {
		console.error("Failed to record AI usage analytics", error);
	}
}
