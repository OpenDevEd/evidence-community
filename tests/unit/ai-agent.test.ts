import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/api/cache", () => ({
	getCachedCollections: vi.fn(async () => []),
	getCachedItem: vi.fn(),
}));
vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn(async () => true) }));

import type { ModelMessage } from "ai";

import {
	liftToolResultFilesToUserMessage,
	researchStepLimit,
} from "@/lib/ai/agent";

function readToolMessage(): ModelMessage {
	return {
		role: "tool",
		content: [
			{
				type: "tool-result",
				toolCallId: "call-1",
				toolName: "readPublications",
				output: {
					type: "content",
					value: [
						{ type: "text", text: "Publication metadata" },
						{
							type: "file-data",
							data: "JVBERi0=",
							mediaType: "application/pdf",
							filename: "teacher-training.pdf",
						},
						{ type: "file-url", url: "https://files.example.org/a.pdf" },
					],
				},
			},
		],
	} as ModelMessage;
}

describe("how far the agent may go", () => {
	it("stops a quick answer after six steps and research after twelve", () => {
		expect(researchStepLimit("quick")).toBe(6);
		expect(researchStepLimit("research")).toBe(12);
	});
});

describe("handing read PDFs to the model", () => {
	it("moves the files into a user message the model always reads", () => {
		const messages = liftToolResultFilesToUserMessage([
			{ role: "user", content: "What does it say?" },
			readToolMessage(),
		]);

		expect(messages).toHaveLength(3);
		const handoff = messages[2];
		expect(handoff.role).toBe("user");
		const files = (handoff.content as Array<{ type: string }>).filter(
			(part) => part.type === "file",
		);
		expect(files).toHaveLength(2);
		expect(files[0]).toMatchObject({
			mediaType: "application/pdf",
			filename: "teacher-training.pdf",
		});
	});

	it("leaves a note in the tool result where each file used to be", () => {
		const [, toolMessage] = liftToolResultFilesToUserMessage([
			{ role: "user", content: "What does it say?" },
			readToolMessage(),
		]);
		const output = (
			toolMessage.content as Array<{
				output: { value: Array<{ type: string; text?: string }> };
			}>
		)[0].output;

		expect(output.value.every((part) => part.type === "text")).toBe(true);
		expect(output.value[1].text).toContain("teacher-training.pdf");
	});

	it("changes nothing when no publication was read", () => {
		const messages: ModelMessage[] = [
			{ role: "user", content: "Hello" },
			{ role: "assistant", content: "Hi" },
		];

		expect(liftToolResultFilesToUserMessage(messages)).toEqual(messages);
	});

	it("runs twice without duplicating the attachments", () => {
		const once = liftToolResultFilesToUserMessage([readToolMessage()]);
		const twice = liftToolResultFilesToUserMessage(once);

		expect(twice).toHaveLength(once.length);
	});
});
