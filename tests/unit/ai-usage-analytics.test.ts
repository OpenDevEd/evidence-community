import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const getPostHogForConfig = vi.hoisted(() => vi.fn());

vi.mock("@/lib/posthog", () => ({
	getPostHogForConfig,
}));

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { trackUsage } from "@/lib/ai";

const config = {
	revision: "analytics-usage",
	updatedAt: "2026-07-28T10:00:00.000Z",
	analytics: {
		posthog: {
			host: "https://analytics.example.org",
			key: "phc_1234567890123456",
		},
	},
} as LibraryServerConfig;

const usage = {
	response: { modelId: "runtime-model" },
	usage: {
		promptTokens: 10,
		completionTokens: 20,
		totalTokens: 30,
	},
};

describe("AI usage analytics", () => {
	beforeEach(() => {
		getPostHogForConfig.mockReset();
	});

	it("records usage with the runtime PostHog client", async () => {
		const capture = vi.fn();
		getPostHogForConfig.mockResolvedValue({ capture });

		await trackUsage(
			config,
			"ai_completion",
			usage,
			"runtime-user",
			"Summarize this",
		);

		expect(capture).toHaveBeenCalledWith({
			event: "ai_completion",
			distinctId: "runtime-user",
			properties: {
				model: "runtime-model",
				prompt: "Summarize this",
				prompt_tokens: 10,
				completion_tokens: 20,
				total_tokens: 30,
			},
		});
	});

	it("does not fail completed AI work when analytics setup rejects", async () => {
		const error = new Error("stale runtime revision");
		getPostHogForConfig.mockRejectedValue(error);
		const consoleError = vi
			.spyOn(console, "error")
			.mockImplementation(() => undefined);

		await expect(
			trackUsage(
				config,
				"ai_completion",
				usage,
				"runtime-user",
				"Summarize this",
			),
		).resolves.toBeUndefined();
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

		await expect(
			trackUsage(
				config,
				"ai_completion",
				usage,
				"runtime-user",
				"Summarize this",
			),
		).resolves.toBeUndefined();
		expect(consoleError).toHaveBeenCalledWith(
			"Failed to record AI usage analytics",
			error,
		);
	});

	it("skips capture when runtime PostHog is disabled", async () => {
		getPostHogForConfig.mockResolvedValue(null);

		await expect(
			trackUsage(
				config,
				"ai_completion",
				usage,
				"runtime-user",
				"Summarize this",
			),
		).resolves.toBeUndefined();
	});

	it("does not initialize analytics without a distinct ID", async () => {
		await trackUsage(
			config,
			"ai_completion",
			usage,
			null,
			"Summarize this",
		);

		expect(getPostHogForConfig).not.toHaveBeenCalled();
	});
});
