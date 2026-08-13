// @vitest-environment jsdom

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSearchIndexReceiptStatus } from "@/lib/admin/search-index-contract";

const api = vi.hoisted(() => ({
	overview: vi.fn(),
	receipts: vi.fn(),
	retry: vi.fn(),
}));

vi.mock("@/components/admin/admin-api", () => ({
	getAdminSearchIndexOverview: api.overview,
	getAdminSearchIndexReceipts: api.receipts,
	retryAdminSearchIndex: api.retry,
}));

import { useAdminSearchIndex } from "@/components/admin/useAdminSearchIndex";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const workerOverview = {
	queue: { hasFailed: false, hasPending: false, nextAttemptAt: null },
	worker: {
		active: true,
		batchProgress: null,
		batchUid: null,
		currentEventCount: 0,
		heartbeatAt: "2026-08-04T10:00:00.000Z",
		lastCompletedAt: null,
		lastError: null,
		stage: "idle" as const,
		startedAt: "2026-08-04T09:00:00.000Z",
		stoppedAt: null,
		taskUid: null,
		workerId: "search-indexer",
	},
};

function receiptStatus(
	entityKey: string,
	state: AdminSearchIndexReceiptStatus["state"],
	revision = 1,
): AdminSearchIndexReceiptStatus {
	return {
		attempts: state === "failed" ? 3 : 0,
		createdAt: "2026-08-04T10:00:00.000Z",
		entityKey,
		entityType: "item",
		error: state === "failed" ? "Meilisearch rejected the update" : null,
		nextAttemptAt: "2026-08-04T10:00:00.000Z",
		processedAt:
			state === "indexed" ? "2026-08-04T10:00:01.000Z" : null,
		revision,
		state,
	};
}

type SearchIndexHook = ReturnType<typeof useAdminSearchIndex>;

async function flushAsync() {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
	await new Promise((resolve) => window.setTimeout(resolve, 0));
}

async function flushPromises() {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe("useAdminSearchIndex", () => {
	let container: HTMLDivElement;
	let current: SearchIndexHook;
	let root: Root;

	function Harness() {
		const state = useAdminSearchIndex();
		useLayoutEffect(() => {
			current = state;
		}, [state]);
		return null;
	}

	beforeEach(() => {
		api.overview.mockReset().mockResolvedValue(workerOverview);
		api.receipts.mockReset().mockResolvedValue({ receipts: [] });
		api.retry.mockReset().mockResolvedValue({ receipts: [], requeued: 0 });
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	async function renderHarness() {
		await act(async () => {
			root.render(<Harness />);
			await flushAsync();
		});
	}

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	it("tracks a mutation receipt through authoritative indexed completion", async () => {
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map((entry: { entityKey: string; revision: number }) =>
				receiptStatus(entry.entityKey, "indexed", entry.revision),
			),
		}));
		await renderHarness();

		await act(async () => {
			current.track([
				{ entityKey: "TESTBOOK", entityType: "item", revision: 7 },
			]);
			await flushAsync();
		});

		expect(api.receipts).toHaveBeenCalledWith(
			[{ entityKey: "TESTBOOK", entityType: "item", revision: 7 }],
			expect.any(AbortSignal),
		);
		expect(current.receipts).toEqual([]);
		expect(current.view.kind).toBe("indexed");

		api.receipts.mockClear();
		await act(async () => {
			current.track([
				{ entityKey: "TESTBOOK", entityType: "item", revision: 6 },
			]);
			await flushAsync();
		});
		expect(api.receipts).not.toHaveBeenCalled();
		expect(current.view.kind).toBe("indexed");
	});

	it("resolves an action only after every tracked receipt is indexed", async () => {
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map(
				(entry: { entityKey: string; revision: number }) =>
					receiptStatus(
						entry.entityKey,
						entry.entityKey === "23456789" ? "indexed" : "queued",
						entry.revision,
					),
			),
		}));
		await renderHarness();

		let resolved = false;
		let completion!: Promise<void>;
		await act(async () => {
			completion = current.trackAndWait([
				{ entityKey: "23456789", entityType: "item", revision: 7 },
				{ entityKey: "ABCDEFGH", entityType: "item", revision: 4 },
			]);
			completion.then(() => {
				resolved = true;
			});
			await flushAsync();
		});
		expect(resolved).toBe(false);

		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map(
				(entry: { entityKey: string; revision: number }) =>
					receiptStatus(entry.entityKey, "indexed", entry.revision),
			),
		}));
		await act(async () => {
			await current.refresh();
			await completion;
		});

		expect(resolved).toBe(true);
		expect(current.receipts).toEqual([]);
	});

	it("rejects an action when public search fails", async () => {
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map(
				(entry: { entityKey: string; revision: number }) =>
					receiptStatus(entry.entityKey, "failed", entry.revision),
			),
		}));
		await renderHarness();

		let completion!: Promise<void>;
		let rejection!: Promise<void | Error>;
		await act(async () => {
			completion = current.trackAndWait([
				{ entityKey: "23456789", entityType: "item", revision: 7 },
			]);
			rejection = completion.catch((error: Error) => error);
			await flushAsync();
		});

		const error = await rejection;
		expect(error).toBeInstanceOf(Error);
		expect((error as Error).message).toContain(
			"The record was saved, but public search did not finish",
		);
		expect(current.view.kind).toBe("failed");
	});

	it("chunks more than 100 tracked receipts without dropping any", async () => {
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map((entry: { entityKey: string; revision: number }) =>
				receiptStatus(entry.entityKey, "indexed", entry.revision),
			),
		}));
		await renderHarness();
		api.receipts.mockClear();

		const tracked = Array.from({ length: 205 }, (_, index) => ({
			entityKey: `ITEM${String(index).padStart(4, "0")}`,
			entityType: "item" as const,
			revision: 1,
		}));
		await act(async () => {
			current.track(tracked);
			await flushAsync();
		});

		expect(
			api.receipts.mock.calls.map(([receipts]) => receipts.length),
		).toEqual([100, 100, 5]);
		expect(current.receipts).toEqual([]);
		expect(current.view.kind).toBe("indexed");
	});

	it("bounds concurrent receipt status requests", async () => {
		let active = 0;
		let peak = 0;
		api.receipts.mockImplementation(async (receipts) => {
			active += 1;
			peak = Math.max(peak, active);
			await new Promise((resolve) => window.setTimeout(resolve, 5));
			active -= 1;
			return {
				receipts: receipts.map(
					(entry: { entityKey: string; revision: number }) =>
						receiptStatus(entry.entityKey, "indexed", entry.revision),
				),
			};
		});
		await renderHarness();
		const tracked = Array.from({ length: 501 }, (_, index) => ({
			entityKey: `LOAD${String(index).padStart(4, "0")}`,
			entityType: "item" as const,
			revision: 1,
		}));
		await act(async () => {
			current.track(tracked);
			await new Promise((resolve) => window.setTimeout(resolve, 50));
		});

		expect(peak).toBe(4);
		expect(api.receipts).toHaveBeenCalledTimes(6);
		expect(current.receipts).toEqual([]);
	});

	it("bounds completed revision history for long admin sessions", async () => {
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map((entry: { entityKey: string; revision: number }) =>
				receiptStatus(entry.entityKey, "indexed", entry.revision),
			),
		}));
		await renderHarness();
		const tracked = Array.from({ length: 501 }, (_, index) => ({
			entityKey: `HIST${String(index).padStart(4, "0")}`,
			entityType: "item" as const,
			revision: 1,
		}));
		await act(async () => {
			current.track(tracked);
			await flushAsync();
		});
		api.receipts.mockClear();
		await act(async () => {
			current.track([tracked[0]!]);
			await flushAsync();
		});
		expect(api.receipts).toHaveBeenCalledWith(
			[tracked[0]],
			expect.any(AbortSignal),
		);
	});

	it("retries only the exact failed receipts currently being tracked", async () => {
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map((entry: { entityKey: string; revision: number }) =>
				receiptStatus(entry.entityKey, "failed", entry.revision),
			),
		}));
		await renderHarness();
		await act(async () => {
			current.track([
				{ entityKey: "FAILED01", entityType: "item", revision: 3 },
			]);
			await flushAsync();
		});
		expect(current.receipts[0]?.state).toBe("failed");
		expect(current.view.canRetry).toBe(true);

		api.receipts.mockResolvedValue({
			receipts: [receiptStatus("FAILED01", "queued", 3)],
		});
		await act(async () => {
			await current.retry();
			await flushAsync();
		});

		expect(api.retry).toHaveBeenCalledWith({
			receipts: [
				{ entityKey: "FAILED01", entityType: "item", revision: 3 },
			],
			scope: "receipts",
		});
		expect(current.receipts[0]?.state).toBe("queued");
	});

	it("chunks retries at the server contract limit", async () => {
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map((entry: { entityKey: string; revision: number }) =>
				receiptStatus(entry.entityKey, "failed", entry.revision),
			),
		}));
		await renderHarness();
		const tracked = Array.from({ length: 205 }, (_, index) => ({
			entityKey: `FAIL${String(index).padStart(4, "0")}`,
			entityType: "item" as const,
			revision: 1,
		}));
		await act(async () => {
			current.track(tracked);
			await flushAsync();
		});

		api.retry.mockImplementation(async ({ receipts }) => ({
			receipts,
			requeued: receipts.length,
		}));
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map((entry: { entityKey: string; revision: number }) =>
				receiptStatus(entry.entityKey, "queued", entry.revision),
			),
		}));
		await act(async () => {
			await current.retry();
			await flushAsync();
		});

		expect(
			api.retry.mock.calls.map(([request]) => request.receipts.length),
		).toEqual([100, 100, 5]);
		expect(current.receipts).toHaveLength(205);
		expect(current.receipts.every(({ state }) => state === "queued")).toBe(
			true,
		);
	});

	it("retries the global dead-letter queue when no exact failure is tracked", async () => {
		api.overview.mockResolvedValue({
			...workerOverview,
			queue: { ...workerOverview.queue, hasFailed: true },
		});
		await renderHarness();
		await act(async () => {
			await current.retry();
			await flushAsync();
		});
		expect(api.retry).toHaveBeenCalledWith({ scope: "allFailed" });
	});

	it("coalesces repeated retry presses while the request is in flight", async () => {
		api.overview.mockResolvedValue({
			...workerOverview,
			queue: { ...workerOverview.queue, hasFailed: true },
		});
		let finishRetry: (() => void) | undefined;
		api.retry.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishRetry = () => resolve({ receipts: [], requeued: 1 });
				}),
		);
		await renderHarness();

		await act(async () => {
			const first = current.retry();
			const second = current.retry();
			await flushAsync();
			expect(api.retry).toHaveBeenCalledTimes(1);
			finishRetry?.();
			await Promise.all([first, second]);
			await flushAsync();
		});
	});

	it("does not let a slow retry overwrite a newer failed revision", async () => {
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map(
				(entry: { entityKey: string; revision: number }) =>
					receiptStatus(entry.entityKey, "failed", entry.revision),
			),
		}));
		await renderHarness();
		await act(async () => {
			current.track([
				{ entityKey: "FAILED01", entityType: "item", revision: 1 },
			]);
			await flushAsync();
		});

		let finishRetry: (() => void) | undefined;
		api.retry.mockImplementation(
			() =>
				new Promise((resolve) => {
					finishRetry = () =>
						resolve({
							receipts: [
								{
									entityKey: "FAILED01",
									entityType: "item",
									revision: 1,
								},
							],
							requeued: 1,
						});
				}),
		);
		await act(async () => {
			const retry = current.retry();
			await flushPromises();
			current.track([
				{ entityKey: "FAILED01", entityType: "item", revision: 2 },
			]);
			await flushAsync();
			finishRetry?.();
			await retry;
			await flushAsync();
		});

		expect(current.receipts).toEqual([
			expect.objectContaining({
				entityKey: "FAILED01",
				revision: 2,
				state: "failed",
			}),
		]);
	});

	it("treats missing receipts as terminal instead of polling every second", async () => {
		vi.useFakeTimers();
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map((entry: { entityKey: string; revision: number }) =>
				receiptStatus(entry.entityKey, "unknown", entry.revision),
			),
		}));
		await act(async () => {
			root.render(<Harness />);
			await flushPromises();
		});
		await act(async () => {
			current.track([
				{ entityKey: "MISSING1", entityType: "item", revision: 1 },
			]);
			await flushPromises();
		});
		expect(current.receipts).toEqual([
			expect.objectContaining({
				entityKey: "MISSING1",
				state: "unknown",
			}),
		]);
		expect(current.view.kind).toBe("unavailable");
		api.receipts.mockClear();

		await act(async () => {
			await vi.advanceTimersByTimeAsync(9_999);
			await flushPromises();
		});
		expect(api.receipts).not.toHaveBeenCalled();
		expect(current.view.kind).toBe("unavailable");

		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map(
				(entry: { entityKey: string; revision: number }) =>
					receiptStatus(entry.entityKey, "indexed", entry.revision),
			),
		}));
		await act(async () => {
			await current.refresh();
			await flushPromises();
		});
		expect(current.receipts).toEqual([]);
		expect(current.view.kind).toBe("indexed");
	});

	it("polls active work every second and idle state every ten seconds", async () => {
		vi.useFakeTimers();
		api.receipts.mockImplementation(async (receipts) => ({
			receipts: receipts.map((entry: { entityKey: string; revision: number }) =>
				receiptStatus(entry.entityKey, "queued", entry.revision),
			),
		}));
		await act(async () => {
			root.render(<Harness />);
			await flushPromises();
		});
		api.overview.mockClear();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(9_999);
			await flushPromises();
		});
		expect(api.overview).not.toHaveBeenCalled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
			await flushPromises();
		});
		expect(api.overview).toHaveBeenCalledTimes(1);

		await act(async () => {
			current.track([
				{ entityKey: "ACTIVE01", entityType: "item", revision: 1 },
			]);
			await flushPromises();
		});
		api.overview.mockClear();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(999);
			await flushPromises();
		});
		expect(api.overview).not.toHaveBeenCalled();
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1);
			await flushPromises();
		});
		expect(api.overview).toHaveBeenCalledTimes(1);
	});

	it("ignores an aborted request error after a newer refresh succeeds", async () => {
		let rejectFirst: ((reason: unknown) => void) | undefined;
		let overviewCall = 0;
		api.overview.mockImplementation((signal: AbortSignal) => {
			overviewCall += 1;
			if (overviewCall > 1) return Promise.resolve(workerOverview);
			return new Promise((_resolve, reject) => {
				rejectFirst = reject;
				signal.addEventListener(
					"abort",
					() => reject(new DOMException("Aborted", "AbortError")),
					{ once: true },
				);
			});
		});
		await act(async () => {
			root.render(<Harness />);
			await flushPromises();
		});
		await act(async () => {
			await current.refresh();
			rejectFirst?.(new Error("stale failure"));
			await flushAsync();
		});
		expect(current.error).toBeNull();
		expect(current.view.kind).toBe("ready");
	});

	it("aborts the active status request when the admin page unmounts", async () => {
		let signal: AbortSignal | undefined;
		api.overview.mockImplementation(
			(requestSignal: AbortSignal) =>
				new Promise((_resolve, reject) => {
					signal = requestSignal;
					requestSignal.addEventListener(
						"abort",
						() => reject(new DOMException("Aborted", "AbortError")),
						{ once: true },
					);
				}),
		);
		await renderHarness();
		expect(signal?.aborted).toBe(false);
		await act(async () => root.unmount());
		expect(signal?.aborted).toBe(true);
		root = createRoot(container);
	});
});
