import { describe, expect, it } from "vitest";

import type {
	AdminCollectionCatalogEntry,
	AdminSource,
} from "@/lib/admin/types";
import {
	adminCollectionBranchKey,
	adminCollectionCatalogueReducer,
	flattenAdminCollectionCatalogue,
	mergeAdminCollectionCatalogueEntries,
	type AdminCollectionCatalogueState,
} from "@/components/admin/useAdminCollectionCatalogue";

const entry = (
	key: string,
	options: Partial<AdminCollectionCatalogEntry> = {},
): AdminCollectionCatalogEntry => ({
	ancestors: [],
	deleted: false,
	hasChildren: false,
	key,
	name: key,
	parentCollection: null,
	revision: 1,
	sortOrder: 1024,
	sourceConnectionKey: "native",
	updatedAt: "2026-08-03T00:00:00.000Z",
	...options,
});

const nativeSource: AdminSource = {
	key: "native",
	label: "Native",
	provider: "native",
	readOnly: false,
	status: "active",
};

const initialState = (): AdminCollectionCatalogueState => ({
	branches: new Map(),
	entries: new Map(),
	generation: 0,
	search: {
		context: "",
		error: null,
		items: [],
		loadingMore: false,
		loadMoreError: null,
		nextCursor: null,
		requestId: 0,
		status: "idle",
	},
});

describe("admin collection catalogue state", () => {
	it("merges revealed entries with later pages without duplicates", () => {
		const deep = entry("DEEP0001", { sortOrder: 4096 });
		let state = adminCollectionCatalogueReducer(initialState(), {
			entries: [deep],
			type: "reveal",
		});
		const branchKey = adminCollectionBranchKey("native", null);
		state = adminCollectionCatalogueReducer(state, {
			branchKey,
			cursor: null,
			generation: 0,
			requestId: 1,
			type: "branchStart",
		});
		state = adminCollectionCatalogueReducer(state, {
			branchKey,
			cursor: null,
			generation: 0,
			items: [entry("ROOT0001")],
			nextCursor: null,
			requestId: 1,
			type: "branchSuccess",
		});
		expect(state.branches.get(branchKey)).toMatchObject({
			items: [{ key: "ROOT0001" }],
			revealed: [{ key: "DEEP0001" }],
		});
	});

	it("updates a canonical row in place when a newer entry is revealed", () => {
		const branchKey = adminCollectionBranchKey("native", null);
		const original = entry("ROOT0001", { name: "Old name", revision: 1 });
		const sibling = entry("ROOT0002", { name: "Sibling", sortOrder: 2048 });
		const state = adminCollectionCatalogueReducer(
			{
				...initialState(),
				branches: new Map([
					[
						branchKey,
						{
							error: null,
							items: [original, sibling],
							loadingMore: false,
							loadMoreError: null,
							nextCursor: null,
							revealed: [],
							requestId: 1,
							status: "ready",
						},
					],
				]),
			},
			{
				entries: [entry("ROOT0001", { name: "New name", revision: 2 })],
				type: "reveal",
			},
		);

		expect(
			state.branches
				.get(branchKey)
				?.items.map(({ key, name, revision }) => [key, name, revision]),
		).toEqual([
			["ROOT0001", "New name", 2],
			["ROOT0002", "Sibling", 1],
		]);
		expect(state.branches.get(branchKey)?.revealed).toEqual([]);
	});

	it("moves a revealed entry out of its previous cached branch", () => {
		const oldBranchKey = adminCollectionBranchKey("native", null);
		const newBranchKey = adminCollectionBranchKey("native", "PARENT01");
		const moved = entry("MOVED001", { name: "Moved" });
		const state = adminCollectionCatalogueReducer(
			{
				...initialState(),
				branches: new Map([
					[
						oldBranchKey,
						{
							error: null,
							items: [moved],
							loadingMore: false,
							loadMoreError: null,
							nextCursor: null,
							revealed: [],
							requestId: 1,
							status: "ready",
						},
					],
				]),
			},
			{
				entries: [
					entry("MOVED001", {
						ancestors: [{ key: "PARENT01", name: "Parent" }],
						parentCollection: "PARENT01",
						revision: 2,
					}),
				],
				type: "reveal",
			},
		);

		expect(state.branches.get(oldBranchKey)?.items).toEqual([]);
		expect(state.branches.get(newBranchKey)?.revealed).toMatchObject([
			{ key: "MOVED001", revision: 2 },
		]);
	});

	it("clears a stale search cursor when refreshing the first page", () => {
		const context = JSON.stringify({ query: "teacher" });
		const state = adminCollectionCatalogueReducer(
			{
				...initialState(),
				search: {
					context,
					error: null,
					items: [entry("OLDPAGE1")],
					loadingMore: false,
					loadMoreError: null,
					nextCursor: "stale-page-two",
					requestId: 1,
					status: "ready",
				},
			},
			{
				context,
				cursor: null,
				generation: 0,
				requestId: 2,
				type: "searchStart",
			},
		);

		expect(state.search.items).toEqual([]);
		expect(state.search.nextCursor).toBeNull();
		expect(state.search.status).toBe("loading");
	});

	it("clears a stale branch cursor when refreshing the first page", () => {
		const branchKey = adminCollectionBranchKey("native", null);
		const state = adminCollectionCatalogueReducer(
			{
				...initialState(),
				branches: new Map([
					[
						branchKey,
						{
							error: null,
							items: [entry("OLDPAGE1")],
							loadingMore: false,
							loadMoreError: null,
							nextCursor: "stale-page-two",
							revealed: [],
							requestId: 1,
							status: "ready",
						},
					],
				]),
			},
			{
				branchKey,
				cursor: null,
				generation: 0,
				requestId: 2,
				type: "branchStart",
			},
		);

		expect(state.branches.get(branchKey)).toMatchObject({
			items: [{ key: "OLDPAGE1" }],
			nextCursor: null,
			status: "loading",
		});
	});

	it("ignores responses from an invalidated generation", () => {
		const branchKey = adminCollectionBranchKey("native", null);
		const invalidated = adminCollectionCatalogueReducer(initialState(), {
			type: "invalidate",
		});
		const state = adminCollectionCatalogueReducer(invalidated, {
			branchKey,
			cursor: null,
			generation: 0,
			items: [entry("STALE001")],
			nextCursor: null,
			requestId: 1,
			type: "branchSuccess",
		});
		expect(state.branches.size).toBe(0);
		expect(state.generation).toBe(1);
	});

	it("flattens only visible branches and preserves pagination rows", () => {
		const root = entry("ROOT0001", { hasChildren: true });
		const child = entry("CHILD001", {
			ancestors: [{ key: root.key, name: root.name }],
			parentCollection: root.key,
		});
		const rootKey = adminCollectionBranchKey("native", null);
		const childKey = adminCollectionBranchKey("native", root.key);
		const state: AdminCollectionCatalogueState = {
			...initialState(),
			branches: new Map([
				[
					rootKey,
					{
						error: null,
						items: [root],
						loadingMore: false,
						loadMoreError: null,
						nextCursor: "next-root-page",
						revealed: [],
						requestId: 1,
						status: "ready",
					},
				],
				[
					childKey,
					{
						error: null,
						items: [child],
						loadingMore: false,
						loadMoreError: null,
						nextCursor: null,
						revealed: [],
						requestId: 2,
						status: "ready",
					},
				],
			]),
		};
		const collapsed = flattenAdminCollectionCatalogue(
			state,
			[nativeSource],
			new Set(["native"]),
			new Set(),
		);
		expect(collapsed.map(({ kind }) => kind)).toEqual([
			"source",
			"collection",
			"loadMore",
		]);
		const expanded = flattenAdminCollectionCatalogue(
			state,
			[nativeSource],
			new Set(["native"]),
			new Set([root.key]),
		);
		expect(
			expanded.flatMap((row) =>
				row.kind === "collection" ? [row.entry.key] : [],
			),
		).toEqual([root.key, child.key]);
	});

	it("replaces the load-more action with a loading row while paginating", () => {
		const rootKey = adminCollectionBranchKey("native", null);
		const state = adminCollectionCatalogueReducer(
			{
				...initialState(),
				branches: new Map([
					[
						rootKey,
						{
							error: null,
							items: [entry("ROOT0001")],
							loadingMore: false,
							loadMoreError: null,
							nextCursor: "next-page",
							revealed: [],
							requestId: 1,
							status: "ready",
						},
					],
				]),
			},
			{
				branchKey: rootKey,
				cursor: "next-page",
				generation: 0,
				requestId: 2,
				type: "branchStart",
			},
		);
		const rows = flattenAdminCollectionCatalogue(
			state,
			[nativeSource],
			new Set(["native"]),
			new Set(),
		);

		expect(rows.at(-1)?.kind).toBe("loading");
		expect(rows.some(({ kind }) => kind === "loadMore")).toBe(false);
	});

	it("keeps catalogue order stable while replacing revisions", () => {
		const merged = mergeAdminCollectionCatalogueEntries(
			[
				entry("FIRST001", { sortOrder: 1024 }),
				entry("SECOND01", { sortOrder: 2048 }),
			],
			[
				entry("SECOND01", { revision: 2, sortOrder: 2048 }),
				entry("THIRD001", { sortOrder: 3072 }),
			],
		);
		expect(merged.map(({ key, revision }) => [key, revision])).toEqual([
			["FIRST001", 1],
			["SECOND01", 2],
			["THIRD001", 1],
		]);
	});
});
