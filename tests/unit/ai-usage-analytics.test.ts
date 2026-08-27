import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const analytics = vi.hoisted(() => ({
	capture: vi.fn(),
	context: vi.fn(),
}));

vi.mock("@/lib/server-analytics", () => ({
	captureServerAnalyticsEvent: analytics.capture,
	getServerAnalyticsContext: analytics.context,
}));

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { trackUsage } from "@/lib/ai";

const config = {
	revision: "analytics-usage",
	updatedAt: "2026-07-28T10:00:00.000Z",
	analytics: {
		consentPolicyVersion: 1,
		posthog: {
			host: "https://analytics.example.org",
			key: "phc_1234567890123456",
		},
	},
	identity: { baseUrl: "https://library.example.org" },
} as LibraryServerConfig;

const request = new Request("https://library.example.org/api/ai");
const usage = {
	finishReason: "stop",
	response: { modelId: "runtime-model" },
	totalUsage: {
		inputTokens: 10,
		outputTokens: 20,
		totalTokens: 30,
		inputTokenDetails: {
			cacheReadTokens: 4,
			cacheWriteTokens: 2,
		},
		outputTokenDetails: { reasoningTokens: 5 },
	},
};

describe("AI usage analytics", () => {
	beforeEach(() => {
		analytics.capture.mockReset();
		analytics.context.mockReset();
		analytics.context.mockReturnValue({
			mode: "consented",
			distinctId: "runtime-user",
		});
	});

	it("records only model, status, duration, and token counts", async () => {
		await trackUsage(
			config,
			request,
			"ai_completion",
			usage,
			"runtime-user",
			1250,
		);

		expect(analytics.context).toHaveBeenCalledWith(
			config,
			request,
			"runtime-user",
		);
		expect(analytics.capture).toHaveBeenCalledWith(config, {
			event: "ai_completion",
			context: { mode: "consented", distinctId: "runtime-user" },
			properties: {
				cache_read_tokens: 4,
				cache_write_tokens: 2,
				duration_ms: 1250,
				finish_reason: "stop",
				input_tokens: 10,
				model: "runtime-model",
				output_tokens: 20,
				reasoning_tokens: 5,
				status: "completed",
				total_tokens: 30,
			},
		});
		const sent = JSON.stringify(analytics.capture.mock.calls);
		expect(sent).not.toContain("prompt");
		expect(sent).not.toContain("Summarize this");
		expect(sent).not.toContain("response body");
	});

	it("records anonymous aggregate usage when no browser identity is allowed", async () => {
		analytics.context.mockReturnValue({ mode: "aggregate" });

		await trackUsage(
			config,
			request,
			"ai_questions",
			usage,
			"spoofed-id",
			5,
		);

		expect(analytics.capture).toHaveBeenCalledWith(
			config,
			expect.objectContaining({ context: { mode: "aggregate" } }),
		);
	});

	it("does not fail completed AI work when analytics rejects", async () => {
		const error = new Error("analytics transport failed");
		analytics.capture.mockRejectedValue(error);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			trackUsage(config, request, "ai_completion", usage, null, 9),
		).resolves.toBeUndefined();
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to record AI usage analytics",
			error,
		);
	});
});
