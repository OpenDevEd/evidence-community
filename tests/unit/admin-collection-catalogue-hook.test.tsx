// @vitest-environment jsdom

import { act, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminCollectionCatalogEntry } from "@/lib/admin/types";

const api = vi.hoisted(() => ({
	getChildren: vi.fn(),
	search: vi.fn(),
}));

vi.mock("@/components/admin/admin-api", () => ({
	getAdminCollectionChildren: api.getChildren,
	searchAdminCollectionCatalog: api.search,
}));

import { useAdminCollectionCatalogue } from "@/components/admin/useAdminCollectionCatalogue";

const entry = (key: string, name = key): AdminCollectionCatalogEntry => ({
	ancestors: [],
	deleted: false,
	hasChildren: false,
	key,
	name,
	parentCollection: null,
	revision: 1,
	sortOrder: 1024,
	sourceConnectionKey: "native",
	updatedAt: "2026-08-03T00:00:00.000Z",
});

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, reject, resolve };
}

type Catalogue = ReturnType<typeof useAdminCollectionCatalogue>;

describe("useAdminCollectionCatalogue", () => {
	let container: HTMLDivElement;
	let current: Catalogue;
	let root: Root;

	function Harness() {
		const catalogue = useAdminCollectionCatalogue();
		useLayoutEffect(() => {
			current = catalogue;
		}, [catalogue]);
		return null;
	}

	beforeEach(async () => {
		api.getChildren.mockReset();
		api.search.mockReset();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		await act(async () => root.render(<Harness />));
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("deduplicates identical first-page branch and search requests before React commits", async () => {
		const branchPage = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		api.getChildren.mockReturnValueOnce(branchPage.promise);
		let firstBranchRequest!: Promise<void>;
		let duplicateBranchRequest!: Promise<void>;
		await act(async () => {
			firstBranchRequest = current.loadChildren("native", null);
			duplicateBranchRequest = current.loadChildren("native", null);
			await Promise.resolve();
		});
		expect(api.getChildren).toHaveBeenCalledTimes(1);
		expect(
			(api.getChildren.mock.calls[0]![1] as AbortSignal).aborted,
		).toBe(false);

		await act(async () => {
			branchPage.resolve({
				hasMore: false,
				items: [entry("BRANCH01")],
				nextCursor: null,
			});
			await Promise.all([firstBranchRequest, duplicateBranchRequest]);
		});

		const searchPage = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		api.search.mockReturnValueOnce(searchPage.promise);
		const searchInput = {
			query: "teacher",
			sourceConnectionKey: null,
			state: "active" as const,
		};
		let firstSearchRequest!: Promise<void>;
		let duplicateSearchRequest!: Promise<void>;
		await act(async () => {
			firstSearchRequest = current.loadSearch(searchInput);
			duplicateSearchRequest = current.loadSearch(searchInput);
			await Promise.resolve();
		});
		expect(api.search).toHaveBeenCalledTimes(1);
		expect((api.search.mock.calls[0]![1] as AbortSignal).aborted).toBe(
			false,
		);

		await act(async () => {
			searchPage.resolve({
				hasMore: false,
				items: [entry("SEARCH01")],
				nextCursor: null,
			});
			await Promise.all([firstSearchRequest, duplicateSearchRequest]);
		});
	});

	it("deduplicates pagination and lets a forced refresh replace its chain", async () => {
		api.getChildren.mockResolvedValueOnce({
			hasMore: true,
			items: [entry("FIRST001")],
			nextCursor: "next-page",
		});
		await act(async () => current.loadChildren("native", null));

		const append = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		const refresh = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		api.getChildren
			.mockReturnValueOnce(append.promise)
			.mockReturnValueOnce(refresh.promise);
		let appendPromise!: Promise<void>;
		await act(async () => {
			appendPromise = current.loadChildren("native", null, { more: true });
			void current.loadChildren("native", null, { more: true });
			await Promise.resolve();
		});
		expect(api.getChildren).toHaveBeenCalledTimes(2);
		const appendSignal = api.getChildren.mock.calls[1]![1] as AbortSignal;

		let refreshPromise!: Promise<void>;
		await act(async () => {
			refreshPromise = current.loadChildren("native", null, { force: true });
			void current.loadChildren("native", null, { more: true });
			await Promise.resolve();
		});
		expect(appendSignal.aborted).toBe(true);
		expect(api.getChildren).toHaveBeenCalledTimes(3);
		expect(
			(api.getChildren.mock.calls[2]![1] as AbortSignal).aborted,
		).toBe(false);

		await act(async () => {
			refresh.resolve({
				hasMore: false,
				items: [entry("FRESH001")],
				nextCursor: null,
			});
			await refreshPromise;
			append.resolve({
				hasMore: false,
				items: [entry("STALE001")],
				nextCursor: null,
			});
			await appendPromise;
		});
		expect(
			current.state.branches
				.get("native\u0000root")
				?.items.map(({ key }) => key),
		).toEqual(["FRESH001"]);
	});

	it("aborts a superseded search context and ignores its response", async () => {
		const first = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		const second = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		api.search
			.mockReturnValueOnce(first.promise)
			.mockReturnValueOnce(second.promise);
		let firstPromise!: Promise<void>;
		await act(async () => {
			firstPromise = current.loadSearch({
				query: "first",
				sourceConnectionKey: null,
				state: "active",
			});
			await Promise.resolve();
		});
		const firstSignal = api.search.mock.calls[0]![1] as AbortSignal;
		let secondPromise!: Promise<void>;
		await act(async () => {
			secondPromise = current.loadSearch({
				query: "second",
				sourceConnectionKey: null,
				state: "active",
			});
			await Promise.resolve();
		});
		expect(firstSignal.aborted).toBe(true);

		await act(async () => {
			second.resolve({
				hasMore: false,
				items: [entry("SECOND01", "Second")],
				nextCursor: null,
			});
			await secondPromise;
			first.resolve({
				hasMore: false,
				items: [entry("FIRST001", "First")],
				nextCursor: null,
			});
			await firstPromise;
		});
		expect(current.state.search.items.map(({ key }) => key)).toEqual([
			"SECOND01",
		]);
	});

	it("aborts active requests on invalidation and unmount", async () => {
		const pending = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		api.getChildren.mockReturnValueOnce(pending.promise);
		let request!: Promise<void>;
		await act(async () => {
			request = current.loadChildren("native", null);
			await Promise.resolve();
		});
		const signal = api.getChildren.mock.calls[0]![1] as AbortSignal;
		await act(async () => current.invalidate());
		expect(signal.aborted).toBe(true);
		pending.resolve({
			hasMore: false,
			items: [entry("STALE001")],
			nextCursor: null,
		});
		await act(async () => request);
		expect(current.state.generation).toBe(1);
		expect(current.state.branches.size).toBe(0);

		const unmountPending = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		api.getChildren.mockReturnValueOnce(unmountPending.promise);
		await act(async () => {
			void current.loadChildren("native", null);
			await Promise.resolve();
		});
		const unmountSignal = api.getChildren.mock.calls[1]![1] as AbortSignal;
		await act(async () => root.unmount());
		expect(unmountSignal.aborted).toBe(true);
		root = createRoot(container);
		await act(async () => root.render(<Harness />));
	});

	it("reloads against the new generation when invalidated in the same act", async () => {
		api.getChildren.mockResolvedValueOnce({
			hasMore: false,
			items: [entry("ORIGINAL")],
			nextCursor: null,
		});
		await act(async () => current.loadChildren("native", null));

		const reloaded = deferred<{
			hasMore: boolean;
			items: AdminCollectionCatalogEntry[];
			nextCursor: string | null;
		}>();
		api.getChildren.mockReturnValueOnce(reloaded.promise);
		let reloadRequest!: Promise<void>;
		await act(async () => {
			current.invalidate();
			reloadRequest = current.loadChildren("native", null);
			await Promise.resolve();
		});
		expect(api.getChildren).toHaveBeenCalledTimes(2);

		await act(async () => {
			reloaded.resolve({
				hasMore: false,
				items: [entry("RELOADED")],
				nextCursor: null,
			});
			await reloadRequest;
		});
		expect(current.state.generation).toBe(1);
		expect(
			current.state.branches
				.get("native\u0000root")
				?.items.map(({ key }) => key),
		).toEqual(["RELOADED"]);
	});

	it("reads a shown branch again for someone else's change without showing it as loading, and keeps it when that read fails", async () => {
		const page = (items: AdminCollectionCatalogEntry[]) => ({ hasMore: false, items, nextCursor: null });
		const shown = () => current.state.branches.get("native\u0000root");
		api.getChildren.mockResolvedValueOnce(page([entry("FIRST001")]));
		await act(async () => current.loadChildren("native", null));

		const again = deferred<ReturnType<typeof page>>();
		api.getChildren.mockReturnValueOnce(again.promise);
		await act(async () => {
			current.refresh();
			await Promise.resolve();
		});
		// Still on screen while it is read again: a tree that emptied here would collapse under the person's pointer.
		expect(shown()?.status).toBe("ready");
		expect(shown()?.items.map(({ key }) => key)).toEqual(["FIRST001"]);

		await act(async () => {
			again.resolve(page([entry("FIRST001"), entry("SECOND02")]));
			await again.promise;
		});
		expect(shown()?.items.map(({ key }) => key)).toEqual(["FIRST001", "SECOND02"]);

		api.getChildren.mockRejectedValueOnce(new Error("offline"));
		await act(async () => {
			current.refresh();
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(shown()?.status).toBe("ready");
		expect(shown()?.error).toBeNull();
		expect(shown()?.items.map(({ key }) => key)).toEqual(["FIRST001", "SECOND02"]);
	});
});
