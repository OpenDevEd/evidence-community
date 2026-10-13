import { DrizzleQueryError } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { clientAIError } from "@/lib/ai/client";
import { AI_CONTEXT_TOO_LARGE_MESSAGE } from "@/lib/ai/error-message";
import {
	AIError,
	aiErrorResponse,
	aiStreamErrorMessage,
	normalizeAIError,
} from "@/lib/ai/errors";

beforeEach(() => {
	vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("controlled AI failures", () => {
	it("tells a user to reset a conversation that outgrew the model", () => {
		const error = normalizeAIError(
			{
				message: "Prompt rejected.",
				metadata: { error_type: "context_length_exceeded" },
			},
			{ context: "conversation" },
		);

		expect(error.code).toBe("CONTEXT_TOO_LARGE");
		expect(error.status).toBe(400);
		expect(error.message).toBe(AI_CONTEXT_TOO_LARGE_MESSAGE);
	});

	it("separates an oversized document from an oversized conversation", () => {
		const error = normalizeAIError(
			{
				message: "Bad request.",
				responseBody: JSON.stringify({
					error: {
						message: "Input exceeds the available tokens.",
						metadata: { error_type: "context_length_exceeded" },
					},
				}),
			},
			{ context: "document" },
		);

		expect(error.code).toBe("DOCUMENT_TOO_LARGE");
		expect(error.status).toBe(413);
		expect(error.message).toMatch(/exceeds this model's context limit/);
	});

	it("explains a gateway rejection buried under retry wrappers", () => {
		const error = normalizeAIError(
			Object.assign(
				new Error("Failed after 3 attempts. Last error: Bad Gateway"),
				{
					lastError: Object.assign(new Error("Bad Gateway"), {
						statusCode: 502,
						responseBody: "<title>502: Bad gateway</title>",
					}),
				},
			),
		);

		expect(error.code).toBe("PROVIDER_ERROR");
		expect(error.status).toBe(502);
		expect(error.message).toMatch(/fewer publications/);
	});

	it("keeps the provider's own words for anything else", () => {
		expect(
			normalizeAIError(new Error("The model is offline")).message,
		).toBe(
			"The AI provider could not complete this request: The model is offline",
		);
		expect(
			normalizeAIError(
				new Error("[object Object]", {
					cause: { error: { message: "The provider is unavailable." } },
				}),
			).message,
		).toMatch(/The provider is unavailable\./);
	});

	it("blames the library, not the AI provider, when its database fails", () => {
		const error = normalizeAIError(
			new DrizzleQueryError("select 1", [], new Error("timeout exceeded when trying to connect")),
		);
		expect(error.code).toBe("LIBRARY_UNAVAILABLE");
		expect(error.status).toBe(503);
		expect(error.message).not.toMatch(/provider/i);
	});

	it("passes an AIError through untouched", () => {
		const original = new AIError("ITEM_NOT_FOUND", "No such record.", 404);
		expect(normalizeAIError(original)).toBe(original);
	});

	it("answers a failed request with a coded JSON body", async () => {
		const response = aiErrorResponse(
			new AIError("AI_DISABLED", "AI is switched off.", 503),
		);

		expect(response.status).toBe(503);
		await expect(response.json()).resolves.toEqual({
			error: { code: "AI_DISABLED", message: "AI is switched off." },
		});
	});

	it("gives a stream one readable line instead of a stack", () => {
		expect(
			aiStreamErrorMessage(new AIError("RATE_LIMITED", "Slow down.", 429)),
		).toBe("Slow down.");
	});

	it("unwraps the message the browser should show", () => {
		expect(
			clientAIError(
				new Error(
					JSON.stringify({
						error: {
							code: "MODEL_UNAVAILABLE",
							message: "Model is offline.",
						},
					}),
				),
			).message,
		).toBe("Model is offline.");
	});
});

it("uses the normal unavailable error for an upstream HTML error page", () => {
  const generic = clientAIError(new Error("")).message;
  expect(generic.length).toBeGreaterThan(0);
  expect(clientAIError(new Error('<!DOCTYPE html><html><head><title>524 timeout</title></head><body>Proxy error</body></html>')).message).toBe(generic);
});
