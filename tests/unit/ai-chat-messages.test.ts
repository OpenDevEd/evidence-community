import { describe, expect, it } from "vitest";

import type { ResearchUIMessage } from "@/lib/ai/agent";
import {
	createTextMessage,
	withLatestRequestContext,
} from "@/lib/ai/chat-messages";
import {
	createResearchRequestContextSnapshot,
	latestResearchRequestContext,
} from "@/lib/ai/request-context";

const onScreen = createResearchRequestContextSnapshot({
	currentPublication: { key: "ABC123", title: "Teacher training in Kenya" },
});

const somethingElse = createResearchRequestContextSnapshot({
	currentPublication: { key: "XYZ789", title: "School meals in Malawi" },
});

function conversation(): ResearchUIMessage[] {
	return [
		createTextMessage("assistant", "Hello", "greeting"),
		createTextMessage("user", "What does this say?", "question-1"),
	];
}

describe("what the assistant is told the reader is looking at", () => {
	it("records the current publication on the newest question", () => {
		const updated = withLatestRequestContext(conversation(), onScreen);

		expect(latestResearchRequestContext(updated)).toEqual(onScreen);
	});

	it("adds nothing when the question already carries that context", () => {
		const once = withLatestRequestContext(conversation(), onScreen);
		const twice = withLatestRequestContext(once, onScreen);

		expect(twice).toBe(once);
		expect(twice.at(-1)?.parts).toHaveLength(2);
	});

	it("replaces the context when the reader has moved on", () => {
		const before = withLatestRequestContext(conversation(), onScreen);
		const after = withLatestRequestContext(before, somethingElse);

		expect(latestResearchRequestContext(after)).toEqual(somethingElse);
	});

	it("leaves a conversation with no question alone", () => {
		const greetingOnly = [createTextMessage("assistant", "Hello", "g")];

		expect(withLatestRequestContext(greetingOnly, onScreen)).toBe(
			greetingOnly,
		);
	});
});

describe("plain messages", () => {
	it("keeps the text, the sender, and the id it was given", () => {
		const message = createTextMessage("user", "Summarise this", "q1");

		expect(message).toEqual({
			id: "q1",
			role: "user",
			parts: [{ type: "text", text: "Summarise this" }],
		});
	});
});
