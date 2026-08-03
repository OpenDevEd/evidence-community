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
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
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
			current.retry();
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
			current.retry();
			await flushResolution();
		});
		expect(current.entries).toEqual([collection]);
		expect(current.error).toBe(true);
	});
});
