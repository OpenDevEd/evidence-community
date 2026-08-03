// @vitest-environment jsdom

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";

const api = vi.hoisted(() => ({ resolve: vi.fn() }));

vi.mock("@/components/admin/admin-api", () => ({
	resolveAdminCollectionCatalog: api.resolve,
}));

import { useResolvedAdminCollections } from "@/components/admin/useResolvedAdminCollections";
import { requestAdminCollectionCatalogueInvalidation } from "@/components/admin/admin-collection-events";
import {
	invalidateAdminCollectionResolutionCache,
	resolveAdminCollectionKeys,
} from "@/components/admin/admin-collection-resolution-cache";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const collection: AdminCollectionCatalogEntry = {
	ancestors: [],
	deleted: false,
	hasChildren: false,
	key: "RESOLVE1",
	name: "Resolved collection",
	parentCollection: null,
	revision: 1,
	sortOrder: 0,
	sourceConnectionKey: "native",
	updatedAt: "2026-08-03T00:00:00.000Z",
};

type Resolution = ReturnType<typeof useResolvedAdminCollections>;

async function flushResolution() {
	for (let index = 0; index < 6; index += 1) await Promise.resolve();
}

describe("useResolvedAdminCollections", () => {
	let container: HTMLDivElement;
	let current: Resolution;
	let root: Root;

	function Harness() {
		const resolution = useResolvedAdminCollections([collection.key]);
		useLayoutEffect(() => {
			current = resolution;
		}, [resolution]);
		return null;
	}

	beforeEach(() => {
		api.resolve.mockReset();
		invalidateAdminCollectionResolutionCache();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	it("removes cached entries when a successful retry no longer resolves them", async () => {
		api.resolve
			.mockResolvedValueOnce({ items: [collection] })
			.mockResolvedValueOnce({ items: [] });
		await act(async () => {
			root.render(<Harness />);
			await flushResolution();
		});
		expect(current.entries).toEqual([collection]);

		await act(async () => {
			requestAdminCollectionCatalogueInvalidation();
			await flushResolution();
		});
		expect(current.entries).toEqual([]);
		expect(current.error).toBe(false);
	});

	it("retains cached entries only when their retry chunk fails", async () => {
		api.resolve
			.mockResolvedValueOnce({ items: [collection] })
			.mockRejectedValueOnce(new Error("offline"));
		await act(async () => {
			root.render(<Harness />);
			await flushResolution();
		});

		await act(async () => {
			requestAdminCollectionCatalogueInvalidation();
			await flushResolution();
		});
		expect(current.entries).toEqual([collection]);
		expect(current.error).toBe(true);
	});

	it("automatically retries failed chunks only up to the configured bound", async () => {
		vi.useFakeTimers();
		api.resolve
			.mockRejectedValueOnce(new Error("offline"))
			.mockRejectedValueOnce(new Error("offline"))
			.mockResolvedValueOnce({ items: [collection] });

		function AutoRetryHarness() {
			const resolution = useResolvedAdminCollections([collection.key], {
				maxAutoRetries: 2,
				retryDelayMs: 1,
			});
			useLayoutEffect(() => {
				current = resolution;
			}, [resolution]);
			return null;
		}

		await act(async () => {
			root.render(<AutoRetryHarness />);
			await flushResolution();
		});
		expect(api.resolve).toHaveBeenCalledTimes(1);

		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
			await flushResolution();
			await vi.advanceTimersByTimeAsync(2);
			await flushResolution();
		});

		expect(api.resolve).toHaveBeenCalledTimes(3);
		expect(current.entries).toEqual([collection]);
		expect(current.error).toBe(false);
	});

	it("retries only the failed chunk in a multi-chunk resolution", async () => {
		vi.useFakeTimers();
		const keys = Array.from(
			{ length: 101 },
			(_, index) => `KEY${String(index).padStart(5, "0")}`,
		);
		let firstLargeChunk = true;
		api.resolve.mockImplementation(async (requested: string[]) => {
			if (requested.length === 100 && firstLargeChunk) {
				firstLargeChunk = false;
				throw new Error("offline");
			}
			return { items: [] };
		});

		function ChunkedHarness() {
			const resolution = useResolvedAdminCollections(keys, {
				maxAutoRetries: 1,
				retryDelayMs: 1,
			});
			useLayoutEffect(() => {
				current = resolution;
			}, [resolution]);
			return null;
		}

		await act(async () => {
			root.render(<ChunkedHarness />);
			await flushResolution();
		});
		expect(api.resolve).toHaveBeenCalledTimes(2);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
			await flushResolution();
		});

		expect(
			api.resolve.mock.calls.map(([requested]) => requested.length),
		).toEqual([100, 1, 100]);
		expect(current.error).toBe(false);
	});

	it("requests only newly added keys as a loaded item page grows", async () => {
		const nextCollection = { ...collection, key: "RESOLVE2", name: "Next" };
		let keys = [collection.key];
		function GrowingHarness() {
			const resolution = useResolvedAdminCollections(keys);
			useLayoutEffect(() => {
				current = resolution;
			}, [resolution]);
			return null;
		}
		api.resolve
			.mockResolvedValueOnce({ items: [collection] })
			.mockResolvedValueOnce({ items: [nextCollection] });

		await act(async () => {
			root.render(<GrowingHarness />);
			await flushResolution();
		});
		keys = [collection.key, nextCollection.key];
		await act(async () => {
			root.render(<GrowingHarness />);
			await flushResolution();
		});

		expect(api.resolve).toHaveBeenCalledTimes(2);
		expect(api.resolve.mock.calls[1]?.[0]).toEqual([nextCollection.key]);
		expect(current.entries).toEqual([collection, nextCollection]);
	});

	it("cancels stale viewport work when the mounted keys change", async () => {
		const currentCollection = {
			...collection,
			key: "CURRENT1",
			name: "Current viewport",
		};
		let keys = ["STALE001"];
		let staleSignal: AbortSignal | undefined;
		api.resolve
			.mockImplementationOnce(
				(_requested: string[], signal: AbortSignal) =>
					new Promise((_resolve, reject) => {
						staleSignal = signal;
						signal.addEventListener(
							"abort",
							() =>
								reject(
									new DOMException("Aborted", "AbortError"),
								),
							{ once: true },
						);
					}),
			)
			.mockResolvedValueOnce({ items: [currentCollection] });

		function ViewportHarness() {
			const resolution = useResolvedAdminCollections(keys);
			useLayoutEffect(() => {
				current = resolution;
			}, [resolution]);
			return null;
		}

		await act(async () => {
			root.render(<ViewportHarness />);
			await flushResolution();
		});
		expect(api.resolve).toHaveBeenCalledTimes(1);

		keys = [currentCollection.key];
		await act(async () => {
			root.render(<ViewportHarness />);
			await flushResolution();
		});

		expect(staleSignal?.aborted).toBe(true);
		expect(api.resolve).toHaveBeenCalledTimes(2);
		expect(api.resolve.mock.calls[1]?.[0]).toEqual([currentCollection.key]);
		expect(current.entries).toEqual([currentCollection]);
	});

	it("refreshes unchanged keys after a catalogue mutation invalidation", async () => {
		const renamed = { ...collection, name: "Renamed collection" };
		api.resolve
			.mockResolvedValueOnce({ items: [collection] })
			.mockResolvedValueOnce({ items: [renamed] });
		await act(async () => {
			root.render(<Harness />);
			await flushResolution();
		});

		await act(async () => {
			requestAdminCollectionCatalogueInvalidation();
			await flushResolution();
		});

		expect(api.resolve).toHaveBeenCalledTimes(2);
		expect(current.entries).toEqual([renamed]);
	});

	it("bounds the shared cache while returning every entry to the caller", async () => {
		const keys = Array.from(
			{ length: 2_001 },
			(_, index) => `LRU${String(index).padStart(5, "0")}`,
		);
		api.resolve.mockImplementation(async (requested: string[]) => ({
			items: requested.map((key) => ({ ...collection, key, name: key })),
		}));

		const result = await resolveAdminCollectionKeys(keys);
		expect(result.entries.size).toBe(2_001);
		expect(api.resolve).toHaveBeenCalledTimes(21);

		await resolveAdminCollectionKeys([keys[0]!]);
		expect(api.resolve).toHaveBeenCalledTimes(22);
		expect(api.resolve.mock.calls.at(-1)?.[0]).toEqual([keys[0]]);
	});

	it("batches sibling callers and returns only the keys each caller requested", async () => {
		const second = { ...collection, key: "RESOLVE2", name: "Second" };
		api.resolve.mockResolvedValue({ items: [collection, second] });

		const both = resolveAdminCollectionKeys([collection.key, second.key]);
		const overlapping = resolveAdminCollectionKeys([collection.key]);
		const [bothResult, overlappingResult] = await Promise.all([
			both,
			overlapping,
		]);

		expect(api.resolve).toHaveBeenCalledTimes(1);
		expect(api.resolve).toHaveBeenCalledWith(
			[collection.key, second.key],
			expect.any(AbortSignal),
		);
		expect([...bothResult.entries.keys()]).toEqual([
			collection.key,
			second.key,
		]);
		expect([...overlappingResult.entries.keys()]).toEqual([collection.key]);
	});

	it("limits resolution traffic to three concurrent requests", async () => {
		const releases: Array<() => void> = [];
		let active = 0;
		let peak = 0;
		api.resolve.mockImplementation(
			(requested: string[]) =>
				new Promise<{ items: AdminCollectionCatalogEntry[] }>(
					(resolve) => {
						active += 1;
						peak = Math.max(peak, active);
						releases.push(() => {
							active -= 1;
							resolve({
								items: requested.map((key) => ({
									...collection,
									key,
								})),
							});
						});
					},
				),
		);
		const resolution = resolveAdminCollectionKeys(
			Array.from({ length: 401 }, (_, index) => `LIMIT${index}`),
		);
		await flushResolution();
		expect(api.resolve).toHaveBeenCalledTimes(3);

		while (releases.length > 0) {
			const release = releases.shift()!;
			release();
			await flushResolution();
		}
		await resolution;
		expect(api.resolve).toHaveBeenCalledTimes(5);
		expect(peak).toBe(3);
	});
});
