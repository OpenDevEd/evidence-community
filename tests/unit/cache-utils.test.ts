import { afterEach, expect, it, vi } from "vitest";

const stored = new Map<string, { content: string; computedAt: number }>();
const cacheIndex = {
	getDocument: vi.fn(async (id: string) => {
		const document = stored.get(id);
		if (!document) throw new Error("Document not found");
		return document;
	}),
	addDocuments: vi.fn(async (documents: { id: string; content: string; computedAt: number }[]) => {
		for (const { id, ...document } of documents) stored.set(id, document);
	}),
};
vi.mock("@/lib/meilisearch", () => ({ getMeilisearchForConfig: async () => ({ cacheIndex, indexName: "library" }) }));

const { peekMeilisearchCache, withMeilisearchCache } = await import("@/lib/cache-utils");
const config = {} as Parameters<typeof withMeilisearchCache>[0];

afterEach(() => vi.useRealTimers());

// The module remembers values for the life of the process, so each test uses its own key.
function pending<T>(value: T) {
	let release!: () => void;
	const compute = vi.fn(() => new Promise<T>((resolve) => (release = () => resolve(value))));
	return { compute, release: () => release() };
}

it("runs one compute for concurrent callers and serves the cached value afterwards", async () => {
	const { compute, release } = pending({ count: 7 });
	const first = withMeilisearchCache(config, "shared", compute);
	const second = withMeilisearchCache(config, "shared", compute);
	await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(1));
	release();
	expect(await Promise.all([first, second])).toEqual([{ count: 7 }, { count: 7 }]);
	expect(await withMeilisearchCache(config, "shared", compute)).toEqual({ count: 7 });
	expect(compute).toHaveBeenCalledTimes(1);
});

it("answers null at once while the value is computed in the background, then the value", async () => {
	const { compute, release } = pending({ count: 3 });
	expect(await peekMeilisearchCache(config, "peeked", compute)).toBeNull();
	// A second look while it runs starts nothing new.
	expect(await peekMeilisearchCache(config, "peeked", compute)).toBeNull();
	expect(compute).toHaveBeenCalledTimes(1);
	release();
	await vi.waitFor(() => expect(stored.has("library-peeked")).toBe(true));
	expect(await peekMeilisearchCache(config, "peeked", compute)).toEqual({ count: 3 });
});

it("keeps answering with an old value while a fresh one is computed behind it", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	const compute = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 2 });
	expect(await peekMeilisearchCache(config, "aged", compute, { maxAgeMs: 60_000 })).toBeNull();
	await vi.waitFor(() => expect(stored.has("library-aged")).toBe(true));
	vi.setSystemTime(Date.now() + 61_000);
	expect(await peekMeilisearchCache(config, "aged", compute, { maxAgeMs: 60_000 })).toEqual({ count: 1 });
	await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(2));
	await vi.waitFor(async () => expect(await peekMeilisearchCache(config, "aged", compute, { maxAgeMs: 60_000 })).toEqual({ count: 2 }));
});

it("still answers from memory when the cache write fails, and tries again after a failed compute", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	cacheIndex.addDocuments.mockRejectedValueOnce(new Error("payload too large"));
	const compute = vi.fn().mockRejectedValueOnce(new Error("pool timeout")).mockResolvedValue({ count: 5 });
	expect(await peekMeilisearchCache(config, "unwritten", compute)).toBeNull();
	await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("computing unwritten failed"), expect.anything()));
	expect(await peekMeilisearchCache(config, "unwritten", compute)).toBeNull();
	await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("writing library-unwritten failed"), expect.anything()));
	expect(await peekMeilisearchCache(config, "unwritten", compute)).toEqual({ count: 5 });
	expect(compute).toHaveBeenCalledTimes(2);
	error.mockRestore();
});
