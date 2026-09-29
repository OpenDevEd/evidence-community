import { beforeEach, expect, it, vi } from "vitest";

const stored = new Map<string, string>();
const cacheIndex = {
	getDocument: vi.fn(async (id: string) => {
		const content = stored.get(id);
		if (content === undefined) throw new Error("Document not found");
		return { content };
	}),
	addDocuments: vi.fn(async (documents: { id: string; content: string }[]) => {
		for (const document of documents) stored.set(document.id, document.content);
	}),
};
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: async () => ({ cacheIndex, indexName: "library" }) }));

const { peekMeilisearchCache, withMeilisearchCache } = await import("@/lib/cache-utils");
const config = {} as Parameters<typeof withMeilisearchCache>[0];

beforeEach(() => stored.clear());

it("runs one compute for concurrent callers and serves the cached value afterwards", async () => {
	let release!: () => void;
	const compute = vi.fn(() => new Promise<{ count: number }>((resolve) => (release = () => resolve({ count: 7 }))));
	const first = withMeilisearchCache(config, "stats", compute);
	const second = withMeilisearchCache(config, "stats", compute);
	await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(1));
	release();
	expect(await Promise.all([first, second])).toEqual([{ count: 7 }, { count: 7 }]);
	expect(await withMeilisearchCache(config, "stats", compute)).toEqual({ count: 7 });
	expect(compute).toHaveBeenCalledTimes(1);
});

it("answers null at once while the value is computed in the background, then the value", async () => {
	let release!: () => void;
	const compute = vi.fn(() => new Promise<{ count: number }>((resolve) => (release = () => resolve({ count: 3 }))));
	expect(await peekMeilisearchCache(config, "stats", compute)).toBeNull();
	// A second look while it runs starts nothing new.
	expect(await peekMeilisearchCache(config, "stats", compute)).toBeNull();
	expect(compute).toHaveBeenCalledTimes(1);
	release();
	await vi.waitFor(() => expect(stored.size).toBe(1));
	expect(await peekMeilisearchCache(config, "stats", compute)).toEqual({ count: 3 });
});

it("tries again on the next look after a compute fails", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const compute = vi.fn().mockRejectedValueOnce(new Error("pool timeout")).mockResolvedValue({ count: 1 });
	expect(await peekMeilisearchCache(config, "stats", compute)).toBeNull();
	await vi.waitFor(() => expect(error).toHaveBeenCalled());
	expect(await peekMeilisearchCache(config, "stats", compute)).toBeNull();
	await vi.waitFor(() => expect(stored.size).toBe(1));
	expect(compute).toHaveBeenCalledTimes(2);
	error.mockRestore();
});
