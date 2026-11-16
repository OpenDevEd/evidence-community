import { describe, expect, it } from "vitest";

import {
	CHAT_EXPORT_OUTPUT,
	chatMessageContent,
	chatTranscriptContent,
} from "@/lib/ai/transcript-export";

const labels = {
	title: "Ask AI",
	user: "User",
	assistant: "GPT-5.6 Luna",
	reasoning: "Reasoning",
	smartScreening: "Smart Screening",
};

const conversation = [
	{
		id: "message-1",
		role: "user",
		parts: [{ type: "text", text: "Which studies used radio?" }],
	},
	{
		id: "message-2",
		role: "assistant",
		parts: [
			{ type: "reasoning", text: "Checking the library first." },
			{
				type: "tool-searchLibrary",
				toolCallId: "call-1",
				state: "output-available",
				input: { queries: ["radio teaching"] },
				output: { queries: [{ query: "radio teaching", hits: [{}] }] },
			},
			{
				type: "text",
				text: "Radio reached rural schools. [PAGE /lib/ABCD1234/download/PDF00001 — 12 PAGE/]",
			},
		],
	},
] as never;

describe("keeping a copy of the conversation", () => {
	it("writes both sides, the reasoning, and the steps as markdown", async () => {
		const markdown = await chatTranscriptContent(
			"markdown",
			conversation,
			labels,
			"https://library.example.org",
		);

		expect(markdown).toContain("# Ask AI");
		expect(markdown).toContain("## User");
		expect(markdown).toContain("Which studies used radio?");
		expect(markdown).toContain("## GPT-5.6 Luna");
		expect(markdown).toContain("### Reasoning");
		expect(markdown).toContain("radio teaching");
	});

	it("keeps a real link but drops an unsafe one when exported as a web page", async () => {
		const html = await chatTranscriptContent(
			"html",
			[
				{
					id: "message-4",
					role: "assistant",
					parts: [
						{
							type: "text",
							text: "See [the study](https://example.org) and [this](javascript:alert(1)).",
						},
					],
				},
			] as never,
			labels,
		);

		expect(html).toContain('<a href="https://example.org">the study</a>');
		expect(html).not.toMatch(/<a [^>]*javascript:/);
		expect(html).toContain("this");
	});

	it("turns a page citation into a link anyone can follow", async () => {
		const markdown = await chatTranscriptContent(
			"markdown",
			conversation,
			labels,
			"https://library.example.org",
			{ "radio.pdf": "/lib/ABCD1234/download/PDF00001" },
		);

		expect(markdown).toContain(
			"[Source, p. 12](https://library.example.org/lib/ABCD1234/download/PDF00001#page=12)",
		);
		expect(markdown).not.toContain("PAGE/]");
	});

	it("links a page citation whose opening PAGE marker the model dropped", async () => {
		const markdown = await chatTranscriptContent(
			"markdown",
			[
				{
					id: "message-5",
					role: "assistant",
					parts: [
						{
							type: "text",
							text: "Human feedback stayed stronger [/lib/27BGDU89/download/IUA7YXN9 — 1 PAGE/]. [see table 2] [/lib/B88FNQ7J/download/IJEFHXHF — 17 PAGE/] [/lib/B88FNQ7J/download/IJEFHXHF — 2 PAGE/](https://example.org/original)",
						},
					],
				},
			] as never,
			labels,
			"https://library.example.org",
			{
				"feedback.pdf": "/lib/27BGDU89/download/IUA7YXN9",
				"essays.pdf": "/lib/B88FNQ7J/download/IJEFHXHF",
			},
		);

		expect(markdown).toContain(
			"Human feedback stayed stronger [Source, p. 1](https://library.example.org/lib/27BGDU89/download/IUA7YXN9#page=1). [see table 2] [Source, p. 17](https://library.example.org/lib/B88FNQ7J/download/IJEFHXHF#page=17) [/lib/B88FNQ7J/download/IJEFHXHF — 2 PAGE/](https://example.org/original)",
		);
	});

	it("links a page citation whose PAGE marker the model put after a label", async () => {
		const markdown = await chatTranscriptContent(
			"markdown",
			[
				{
					id: "message-6",
					role: "assistant",
					parts: [
						{
							type: "text",
							text: "Not yet peer-reviewed. [Girl Power — PAGE /lib/DGL9WHAA/download/9RMDJSN3 — 22 PAGE/] [see table 2] [Girl Power — PAGE /lib/DGL9WHAA/download/9RMDJSN3 — 2 PAGE/](https://example.org/original)",
						},
					],
				},
			] as never,
			labels,
			"https://library.example.org",
			{ "girl-power.pdf": "/lib/DGL9WHAA/download/9RMDJSN3" },
		);

		expect(markdown).toContain(
			"Not yet peer-reviewed. [Source, p. 22](https://library.example.org/lib/DGL9WHAA/download/9RMDJSN3#page=22) [see table 2] [Girl Power — PAGE /lib/DGL9WHAA/download/9RMDJSN3 — 2 PAGE/](https://example.org/original)",
		);
	});

	it("reads as plain sentences without markup", async () => {
		const plaintext = await chatTranscriptContent(
			"plaintext",
			conversation,
			labels,
		);

		expect(plaintext).toContain("Radio reached rural schools.");
		expect(plaintext).not.toContain("](");
		expect(plaintext).not.toContain("PAGE/]");
	});

	it("escapes anything dangerous when exported as a web page", async () => {
		const risky = [
			{
				id: "message-3",
				role: "assistant",
				parts: [
					{
						type: "text",
						text: "<script>alert('x')</script> and an image ![x](javascript:alert(1))",
					},
				],
			},
		] as never;

		const html = await chatTranscriptContent("html", risky, labels);

		expect(html).toContain("<article>");
		expect(html).not.toContain("<script>");
		expect(html).not.toMatch(/(?:href|src)="javascript:/);
	});

	it("exports one answer without the reasoning or the steps", async () => {
		const answer = await chatMessageContent(
			"markdown",
			conversation[1],
			"https://library.example.org",
		);

		expect(answer).toContain("Radio reached rural schools.");
		expect(answer).not.toContain("Checking the library first.");
		expect(answer).not.toContain("radio teaching");
	});
});
