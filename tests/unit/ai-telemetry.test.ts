import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getPostHogForConfig = vi.hoisted(() => vi.fn());

vi.mock("@/lib/posthog", () => ({
	getPostHogForConfig,
}));

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { trackAIUsage } from "@/lib/ai/telemetry";

const config = {
	revision: "analytics-usage",
	updatedAt: "2026-07-28T10:00:00.000Z",
	identity: { baseUrl: "https://library.example.org" },
	analytics: {
		posthog: {
			host: "https://analytics.example.org",
			key: "phc_1234567890123456",
		},
	},
} as LibraryServerConfig;

const request = {
	feature: "summarize",
	modelId: "openai/gpt-5.6-luna",
	distinctId: "runtime-user",
	startedAt: 1_000,
	success: true,
	now: () => 3_500,
} as const;

describe("AI usage analytics", () => {
	beforeEach(() => {
		getPostHogForConfig.mockReset();
	});

	it("records how a request went without any of its content", async () => {
		const capture = vi.fn();
		getPostHogForConfig.mockResolvedValue({ capture });

		await trackAIUsage(config, {
			...request,
			usage: {
				inputTokens: 10,
				outputTokens: 20,
				totalTokens: 30,
				inputTokenDetails: { cacheReadTokens: 4 },
			},
			providerMetadata: { openrouter: { usage: { cost: 0.42 } } },
			responseHeaders: { "X-OpenRouter-Cache-Status": "HIT" },
			toolCounts: { searchLibrary: 2 },
		});

		expect(capture).toHaveBeenCalledTimes(1);
		const [event] = capture.mock.calls[0];
		expect(event.event).toBe("ai_request");
		expect(event.distinctId).toBe("runtime-user");
		expect(event.properties).toMatchObject({
			environment: "library.example.org",
			feature: "summarize",
			model: "openai/gpt-5.6-luna",
			input_tokens: 10,
			output_tokens: 20,
			total_tokens: 30,
			cache_read_tokens: 4,
			cost_usd: 0.42,
			response_cache_hits: 1,
			duration_ms: 2_500,
			tool_counts: { searchLibrary: 2 },
			success: true,
			error_code: null,
		});
		expect(JSON.stringify(event.properties)).not.toMatch(/prompt/i);
	});

	it("records a failure with its error code", async () => {
		const capture = vi.fn();
		getPostHogForConfig.mockResolvedValue({ capture });

		await trackAIUsage(config, {
			...request,
			success: false,
			errorCode: "PROVIDER_ERROR",
		});

		expect(capture.mock.calls[0][0].properties).toMatchObject({
			success: false,
			error_code: "PROVIDER_ERROR",
			cost_usd: null,
		});
	});

	it("does not fail completed AI work when analytics setup rejects", async () => {
		const error = new Error("stale runtime revision");
		getPostHogForConfig.mockRejectedValue(error);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(trackAIUsage(config, request)).resolves.toBeUndefined();
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to record AI usage analytics",
			error,
		);
	});

	it("does not fail completed AI work when analytics capture throws", async () => {
		const error = new Error("analytics transport failed");
		getPostHogForConfig.mockResolvedValue({
			capture: vi.fn(() => {
				throw error;
			}),
		});
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(trackAIUsage(config, request)).resolves.toBeUndefined();
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to record AI usage analytics",
			error,
		);
	});

	it("skips capture when runtime PostHog is disabled", async () => {
		getPostHogForConfig.mockResolvedValue(null);

		await expect(trackAIUsage(config, request)).resolves.toBeUndefined();
	});

	it("does not initialize analytics without a distinct ID", async () => {
		await trackAIUsage(config, { ...request, distinctId: null });

		expect(getPostHogForConfig).not.toHaveBeenCalled();
	});
});
