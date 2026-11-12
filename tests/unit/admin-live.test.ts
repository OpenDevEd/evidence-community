import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { noteOwnAdminWrite, paceReads } from "@/components/admin/admin-live";

describe("how often a part of the admin reads itself again", () => {
	let hidden = false;
	beforeEach(() => {
		hidden = false;
		vi.useFakeTimers();
		// Past the wait a save made in an earlier test leaves behind.
		vi.setSystemTime(Date.now() + 60_000);
		vi.stubGlobal("document", { get hidden() { return hidden; } });
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	it("reads at once for a change on its own", async () => {
		const read = vi.fn();
		paceReads(read, 1_000).changed();
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("reads each of a few changes at once, as when two people answer each other", async () => {
		const read = vi.fn();
		const paced = paceReads(read, 1_000);
		for (let change = 1; change <= 4; change += 1) {
			paced.changed();
			expect(read).toHaveBeenCalledTimes(change);
			await vi.advanceTimersByTimeAsync(3_000);
		}
	});

	it("reads less often while changes keep coming, and once more after they stop", async () => {
		const read = vi.fn();
		const paced = paceReads(read, 1_000);
		// A change every 100 ms for a minute, as an import makes.
		for (let elapsed = 0; elapsed < 60_000; elapsed += 100) {
			paced.changed();
			await vi.advanceTimersByTimeAsync(100);
		}
		const during = read.mock.calls.length;
		expect(during).toBeGreaterThan(3);
		expect(during).toBeLessThan(12);
		// One last change, right after a read or not: it is read once the pace allows, and only once.
		paced.changed();
		expect(read).toHaveBeenCalledTimes(during);
		await vi.advanceTimersByTimeAsync(20_000);
		expect(read).toHaveBeenCalledTimes(during + 1);
		await vi.advanceTimersByTimeAsync(60_000);
		expect(read).toHaveBeenCalledTimes(during + 1);
	});

	it("reads at once again for a change that comes after a pause", async () => {
		const read = vi.fn();
		const paced = paceReads(read, 1_000);
		for (let elapsed = 0; elapsed < 20_000; elapsed += 100) {
			paced.changed();
			await vi.advanceTimersByTimeAsync(100);
		}
		await vi.advanceTimersByTimeAsync(120_000);
		read.mockClear();
		paced.changed();
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("waits for the page's own saves to finish before it reads", async () => {
		const read = vi.fn();
		const paced = paceReads(read, 1_000);
		// The person types, each save heard back as a change.
		for (let saved = 0; saved < 5; saved += 1) {
			noteOwnAdminWrite("PUT");
			paced.changed();
			await vi.advanceTimersByTimeAsync(800);
		}
		expect(read).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(2_000);
		expect(read).toHaveBeenCalledTimes(1);
	});

	it("reads once when a hidden tab is shown again, however much changed meanwhile", async () => {
		const read = vi.fn();
		const paced = paceReads(read, 1_000);
		hidden = true;
		for (let change = 0; change < 50; change += 1) {
			paced.changed();
			await vi.advanceTimersByTimeAsync(500);
		}
		expect(read).not.toHaveBeenCalled();
		hidden = false;
		paced.shown();
		expect(read).toHaveBeenCalledTimes(1);
	});
});
