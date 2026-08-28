import { describe, expect, it } from "vitest";

import type { ResearchUIMessage } from "@/lib/ai/agent";
import {
	BUCKET_PAGE_SIZE,
	bucketEntriesFromMessages,
	loadBucketPages,
} from "@/lib/ai/context-bucket";

type Part = ResearchUIMessage["parts"][number];

function assistant(...parts: Part[]): ResearchUIMessage {
	return { id: "a1", role: "assistant", parts } as ResearchUIMessage;
}

function reader(text: string): ResearchUIMessage {
	return {
		id: "q1",
		role: "user",
		parts: [{ type: "text", text }],
	} as ResearchUIMessage;
}

function searched(...keys: string[]): Part {
	return {
		type: "tool-searchLibrary",
		toolCallId: "call-search",
		state: "output-available",
		input: {},
		output: { queries: [{ hits: keys.map((key) => ({ key })) }] },
	} as unknown as Part;
}

function read(...itemKeys: string[]): Part {
	return {
		type: "tool-readPublications",
		toolCallId: "call-read",
		state: "output-available",
		input: { itemKeys },
		output: {},
	} as unknown as Part;
}

function text(value: string): Part {
	return { type: "text", text: value } as Part;
}

describe("the publications a conversation has used", () => {
	it("is empty before the assistant has done anything", () => {
		expect(bucketEntriesFromMessages([reader("Hello")])).toEqual([]);
	});

	it("lists what the assistant searched, most recent first", () => {
		const entries = bucketEntriesFromMessages([
			assistant(searched("AAA", "BBB")),
		]);

		expect(entries).toEqual([
			{ key: "BBB", source: "search" },
			{ key: "AAA", source: "search" },
		]);
	});

	it("puts a publication it opened ahead of ones it only found", () => {
		const entries = bucketEntriesFromMessages([
			assistant(searched("AAA", "BBB"), read("AAA")),
		]);

		expect(entries).toEqual([
			{ key: "AAA", source: "read" },
			{ key: "BBB", source: "search" },
		]);
	});

	it("counts a publication the assistant linked to in its answer", () => {
		const entries = bucketEntriesFromMessages([
			assistant(text("See [this study](/lib/CCC) for the numbers.")),
		]);

		expect(entries).toEqual([{ key: "CCC", source: "search" }]);
	});

	it("keeps a link inside a page reference", () => {
		const entries = bucketEntriesFromMessages([
			assistant(text("[PAGE /lib/DDD/download/ATT — 12 PAGE/]")),
		]);

		expect(entries).toEqual([{ key: "DDD", source: "search" }]);
	});

	it("ignores links the reader wrote", () => {
		expect(
			bucketEntriesFromMessages([reader("Look at /lib/EEE please")]),
		).toEqual([]);
	});

	it("lists each publication once, however often it comes up", () => {
		const entries = bucketEntriesFromMessages([
			assistant(searched("AAA")),
			assistant(text("More on /lib/AAA here."), searched("AAA")),
		]);

		expect(entries).toEqual([{ key: "AAA", source: "search" }]);
	});
});

describe("loading the publications a conversation has used", () => {
	it("asks once when they all fit in one request", async () => {
		const asked: number[] = [];
		const items = await loadBucketPages(3, async (page) => {
			asked.push(page);

			return { items: ["a", "b", "c"], totalPages: 1 };
		});

		expect(items).toEqual(["a", "b", "c"]);
		expect(asked).toEqual([1]);
	});

	it("keeps asking until it has more than one page of them", async () => {
		const keyCount = BUCKET_PAGE_SIZE * 2 + 50;
		const asked: number[] = [];
		const items = await loadBucketPages(keyCount, async (page) => {
			asked.push(page);

			return {
				items: Array.from(
					{ length: page === 3 ? 50 : BUCKET_PAGE_SIZE },
					(_, index) => `page${page}-${index}`,
				),
				totalPages: 3,
			};
		});

		expect(asked).toEqual([1, 2, 3]);
		expect(items).toHaveLength(keyCount);
		expect(items[0]).toBe("page1-0");
		expect(items[keyCount - 1]).toBe("page3-49");
	});

	it("gives up and says so when one request fails", async () => {
		const asked: number[] = [];
		const loading = loadBucketPages(BUCKET_PAGE_SIZE * 3, async (page) => {
			asked.push(page);
			if (page === 2) throw new Error("The library did not answer.");

			return {
				items: [`page${page}`],
				totalPages: 3,
			};
		});

		await expect(loading).rejects.toThrow("The library did not answer.");
		expect(asked).toEqual([1, 2]);
	});
});
