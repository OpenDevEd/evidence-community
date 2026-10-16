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
		expect(files).toHaveLength(1);
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

	it("names a later read's PDF as unavailable once earlier reads fill the request", () => {
		const elevenMegabytes = Buffer.alloc(11 * 1024 * 1024).toString("base64");
		const read = (toolCallId: string, filename: string): ModelMessage => ({
			role: "tool",
			content: [
				{
					type: "tool-result",
					toolCallId,
					toolName: "readPublications",
					output: {
						type: "content",
						value: [{ type: "file-data", data: elevenMegabytes, mediaType: "application/pdf", filename }],
					},
				},
			],
		});

		const once = liftToolResultFilesToUserMessage([read("call-1", "first.pdf")]);
		const messages = liftToolResultFilesToUserMessage([...once, read("call-2", "second.pdf")]);

		const files = messages.flatMap((message) =>
			message.role === "user" && Array.isArray(message.content)
				? message.content.filter((part) => part.type === "file")
				: [],
		);
		expect(files.map((file) => file.filename)).toEqual(["first.pdf"]);
		expect(JSON.stringify(messages.at(-1))).toContain("second.pdf");
	});

	it("runs twice without duplicating the attachments", () => {
		const once = liftToolResultFilesToUserMessage([readToolMessage()]);
		const twice = liftToolResultFilesToUserMessage(once);

		expect(twice).toHaveLength(once.length);
	});
});
