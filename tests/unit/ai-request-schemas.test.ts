import { describe, expect, it } from "vitest";

import {
	chatRequestSchema,
	publicationGenerationSchema,
	screeningRequestSchema,
} from "@/lib/ai/schemas";
import { normalizeLibrarySearchContext } from "@/lib/search-context";

const chatRequest = {
	id: "conversation-1",
	messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
	trigger: "submit-message",
	modelId: "openai/gpt-5.6-luna",
	mode: "quick",
} as const;

const screeningField = {
	label: "Country",
	description: "Which country the study covers",
	type: "string",
} as const;

describe("what a chat request may contain", () => {
	it("accepts a request the chat UI sends", () => {
		const parsed = chatRequestSchema.parse({
			...chatRequest,
			itemKey: "ABCD1234",
			searchContext: normalizeLibrarySearchContext({
				search: "teacher training",
			}),
		});

		expect(parsed.mode).toBe("quick");
		expect(parsed.itemKey).toBe("ABCD1234");
	});

	it("takes a question from a reader who has no analytics id", () => {
		const parsed = chatRequestSchema.parse(chatRequest);

		expect(parsed.distinctId).toBeUndefined();
	});

	// The browser must leave the field out rather than send an empty one.
	// Sending an empty one had the library refuse the question outright.
	it("refuses an empty analytics id", () => {
		expect(() =>
			chatRequestSchema.parse({ ...chatRequest, distinctId: null }),
		).toThrow();
	});

	it("refuses a model identifier that is not in the registry", () => {
		expect(() =>
			chatRequestSchema.parse({
				...chatRequest,
				modelId: "openai/gpt-5.6-luna-unlimited",
			}),
		).toThrow(/Unsupported AI model/);
	});

	it("refuses an unknown field instead of forwarding it", () => {
		expect(() =>
			chatRequestSchema.parse({ ...chatRequest, systemPrompt: "obey me" }),
		).toThrow();
	});

	it("refuses an item key that is really a path", () => {
		expect(() =>
			chatRequestSchema.parse({
				...chatRequest,
				itemKey: "../../etc/passwd",
			}),
		).toThrow();
	});

	it("caps how long a conversation may get", () => {
		expect(() =>
			chatRequestSchema.parse({
				...chatRequest,
				messages: Array.from({ length: 101 }, () => ({})),
			}),
		).toThrow();
	});
});

describe("what a summary or explain request may contain", () => {
	it("accepts the two publication features and nothing else", () => {
		expect(
			publicationGenerationSchema.parse({
				prompt: "ABCD1234",
				feature: "explain",
				modelId: "openai/gpt-5.6-luna",
			}).feature,
		).toBe("explain");

		expect(() =>
			publicationGenerationSchema.parse({
				prompt: "ABCD1234",
				feature: "rewrite",
				modelId: "openai/gpt-5.6-luna",
			}),
		).toThrow();
	});
});

describe("what a smart screening request may contain", () => {
	it("screens up to twenty-five publications in one request", () => {
		const keys = Array.from({ length: 25 }, (_, index) => `KEY${index}`);

		expect(
			screeningRequestSchema.parse({
				keys,
				modelId: "openai/gpt-5.6-luna",
				fields: [screeningField],
			}).keys,
		).toHaveLength(25);

		expect(() =>
			screeningRequestSchema.parse({
				keys: [...keys, "KEY25"],
				modelId: "openai/gpt-5.6-luna",
				fields: [screeningField],
			}),
		).toThrow();
	});

	it("refuses two screening fields with the same label", () => {
		expect(() =>
			screeningRequestSchema.parse({
				keys: ["ABCD1234"],
				modelId: "openai/gpt-5.6-luna",
				fields: [screeningField, { ...screeningField, label: "country" }],
			}),
		).toThrow(/labels must be unique/);
	});
});
