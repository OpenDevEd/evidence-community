import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const lookup = vi.hoisted(() => ({ rows: null as Promise<Array<{ toKey: string }>> | null }));
// A database whose redirect query answers with `lookup.rows`.
vi.mock("@/db", () => ({
	getDatabaseForConfig: async () => ({
		select: () => ({ from: () => ({ where: () => ({ limit: () => lookup.rows }) }) }),
	}),
}));

import { readItemRedirect } from "@/lib/item-redirects";

const config = {} as Parameters<typeof readItemRedirect>[0];

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

it("gives up on a lookup after 350 ms and leaves no timer behind", async () => {
	lookup.rows = new Promise(() => {});
	const read = readItemRedirect(config, "OLDKEY01");
	const failed = expect(read).rejects.toThrow("Redirect lookup timeout");
	await vi.advanceTimersByTimeAsync(349);
	expect(vi.getTimerCount()).toBe(1);
	await vi.advanceTimersByTimeAsync(1);
	await failed;
	expect(vi.getTimerCount()).toBe(0);
});

it("answers a quick lookup and clears its timer", async () => {
	lookup.rows = Promise.resolve([{ toKey: "NEWKEY01" }]);
	await expect(readItemRedirect(config, "OLDKEY01")).resolves.toBe("NEWKEY01");
	expect(vi.getTimerCount()).toBe(0);
});
