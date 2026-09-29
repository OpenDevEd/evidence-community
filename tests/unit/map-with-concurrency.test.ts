import { expect, it } from "vitest";

import { mapWithConcurrency } from "@/lib/map-with-concurrency";

it("starts no call after a failure and rejects only when running calls have finished", async () => {
	const started: number[] = [];
	let running = 0;
	const failing = mapWithConcurrency([1, 2, 3, 4, 5, 6], 2, async (value) => {
		started.push(value);
		running++;
		await new Promise((resolve) => setTimeout(resolve, value === 1 ? 5 : 20));
		running--;
		if (value === 1) throw new Error("first failed");
		return value;
	});
	await expect(failing).rejects.toThrow("first failed");
	expect(running).toBe(0);
	expect(started).toEqual([1, 2]);
});
