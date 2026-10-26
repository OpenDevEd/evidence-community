import { afterEach, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

import { schema } from "@/db/database-schema";

/** The `computedCache` rows this stub PostgreSQL client holds, by key. */
const stored = new Map<string, { value: unknown; computedAt: Date }>();
const failing = { writes: 0 };
const query = vi.fn(async ({ text }: { text: string }, values: unknown[]) => {
	if (text.startsWith("select")) {
		const row = stored.get(values[0] as string);
		return { rows: row ? [[row.value, row.computedAt.toISOString()]] : [] };
	}
	if (failing.writes > 0) {
		failing.writes -= 1;
		throw new Error("connection reset");
	}
	const [key, value, computedAt] = values as [string, string, string];
	stored.set(key, { value: JSON.parse(value), computedAt: new Date(computedAt) });
	return { rows: [] };
});
vi.mock("@/db", () => ({ getDatabaseForConfig: async () => drizzle({ query } as never, { schema }) }));

const { peekComputedCache, withComputedCache } = await import("@/lib/cache-utils");
const config = {} as Parameters<typeof withComputedCache>[0];

afterEach(() => vi.useRealTimers());

// The module remembers values for the life of the process, so each test uses its own key.
function pending<T>(value: T) {
	let release!: () => void;
	const compute = vi.fn(() => new Promise<T>((resolve) => (release = () => resolve(value))));
	return { compute, release: () => release() };
}

it("runs one compute for concurrent callers and serves the cached value afterwards", async () => {
	const { compute, release } = pending({ count: 7 });
	const first = withComputedCache(config, "shared", compute);
	const second = withComputedCache(config, "shared", compute);
	await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(1));
	release();
	expect(await Promise.all([first, second])).toEqual([{ count: 7 }, { count: 7 }]);
	expect(await withComputedCache(config, "shared", compute)).toEqual({ count: 7 });
	expect(compute).toHaveBeenCalledTimes(1);
});

it("answers from a value another process saved without computing it again", async () => {
	stored.set("saved", { value: { count: 9 }, computedAt: new Date() });
	const compute = vi.fn();
	expect(await withComputedCache(config, "saved", compute)).toEqual({ count: 9 });
	expect(compute).not.toHaveBeenCalled();
});

it("answers null at once while the value is computed in the background, then the value", async () => {
	const { compute, release } = pending({ count: 3 });
	expect(await peekComputedCache(config, "peeked", compute)).toBeNull();
	// A second look while it runs starts nothing new.
	expect(await peekComputedCache(config, "peeked", compute)).toBeNull();
	expect(compute).toHaveBeenCalledTimes(1);
	release();
	await vi.waitFor(() => expect(stored.has("peeked")).toBe(true));
	expect(await peekComputedCache(config, "peeked", compute)).toEqual({ count: 3 });
});

it("keeps answering with an old value while a fresh one is computed behind it", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	const compute = vi.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 2 });
	expect(await peekComputedCache(config, "aged", compute, { maxAgeMs: 60_000 })).toBeNull();
	await vi.waitFor(() => expect(stored.has("aged")).toBe(true));
	vi.setSystemTime(Date.now() + 61_000);
	expect(await peekComputedCache(config, "aged", compute, { maxAgeMs: 60_000 })).toEqual({ count: 1 });
	await vi.waitFor(() => expect(compute).toHaveBeenCalledTimes(2));
	await vi.waitFor(async () => expect(await peekComputedCache(config, "aged", compute, { maxAgeMs: 60_000 })).toEqual({ count: 2 }));
});

it("still answers from memory when the cache write fails, and tries again after a failed compute", async () => {
	const error = vi.spyOn(console, "error").mockImplementation(() => {});
	const compute = vi.fn().mockRejectedValueOnce(new Error("pool timeout")).mockResolvedValue({ count: 5 });
	expect(await peekComputedCache(config, "unwritten", compute)).toBeNull();
	await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("computing unwritten failed"), expect.anything()));
	failing.writes = 1;
	expect(await peekComputedCache(config, "unwritten", compute)).toBeNull();
	await vi.waitFor(() => expect(error).toHaveBeenCalledWith(expect.stringContaining("writing unwritten failed"), expect.anything()));
	expect(await peekComputedCache(config, "unwritten", compute)).toEqual({ count: 5 });
	expect(compute).toHaveBeenCalledTimes(2);
	error.mockRestore();
});
