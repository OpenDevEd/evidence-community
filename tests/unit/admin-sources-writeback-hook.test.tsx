// @vitest-environment jsdom

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminSourceWritebackStatus } from "@/lib/admin/source-writeback-contract";

const api = vi.hoisted(() => ({
	resolve: vi.fn(),
	retry: vi.fn(),
	status: vi.fn(),
}));

vi.mock("@/components/admin/admin-api", () => ({
	getAdminSourceWritebackStatus: api.status,
	resolveAdminSourceWritebackConflict: api.resolve,
	retryAdminSourceWriteback: api.retry,
}));

import { useAdminSourcesWriteback } from "@/components/admin/useAdminSourcesWriteback";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function status(
	sourceKey: string,
	state: AdminSourceWritebackStatus["state"],
): AdminSourceWritebackStatus {
	return {
		attempts: 0,
		canonicalRevision: 2,
		error: null,
		jobId: 9,
		nextAttemptAt: "2026-08-19T10:00:00.000Z",
		processedAt: state === "synced" ? "2026-08-19T10:00:05.000Z" : null,
		sourceKey,
		state,
	};
}

type Hook = ReturnType<typeof useAdminSourcesWriteback>;

async function flushAsync() {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

describe("useAdminSourcesWriteback", () => {
	let container: HTMLDivElement;
	let current: Hook;
	let root: Root;

	function Harness({ sourceKeys }: { sourceKeys: string[] }) {
		const state = useAdminSourcesWriteback("ITEM2345", sourceKeys, 2);
		useLayoutEffect(() => {
			current = state;
		}, [state]);
		return null;
	}

	beforeEach(() => {
		vi.useFakeTimers();
		api.status.mockReset();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	it("keeps polling while a source is still syncing, and stops claiming it is queued once it is synced", async () => {
		// The server answer changes over time with no change in the record:
		// queued, queued, then synced. The chip must follow without a reload.
		let calls = 0;
		api.status.mockImplementation(async (_item: string, sourceKey: string) => {
			calls += 1;
			return status(sourceKey, calls <= 4 ? "queued" : "synced");
		});

		await act(async () => {
			root.render(<Harness sourceKeys={["zotero-a", "zotero-b"]} />);
			await flushAsync();
		});
		expect(current.entries["zotero-a"]?.status?.state).toBe("queued");
		expect(current.entries["zotero-b"]?.status?.state).toBe("queued");

		// First poll: still queued on the server. Nothing visible changes.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_600);
			await flushAsync();
		});
		expect(current.entries["zotero-a"]?.status?.state).toBe("queued");

		// Second poll must still happen, and now the server says synced.
		await act(async () => {
			await vi.advanceTimersByTimeAsync(1_600);
			await flushAsync();
		});
		expect(current.entries["zotero-a"]?.status?.state).toBe("synced");
		expect(current.entries["zotero-b"]?.status?.state).toBe("synced");
		expect(calls).toBeGreaterThanOrEqual(6);
	});

	it("polls slowly once every source is settled", async () => {
		api.status.mockImplementation(async (_item: string, sourceKey: string) =>
			status(sourceKey, "synced"),
		);
		await act(async () => {
			root.render(<Harness sourceKeys={["zotero-a"]} />);
			await flushAsync();
		});
		const after = api.status.mock.calls.length;
		await act(async () => {
			await vi.advanceTimersByTimeAsync(5_000);
			await flushAsync();
		});
		expect(api.status.mock.calls.length).toBe(after);
		await act(async () => {
			await vi.advanceTimersByTimeAsync(15_000);
			await flushAsync();
		});
		expect(api.status.mock.calls.length).toBeGreaterThan(after);
	});
});
