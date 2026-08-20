// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@/app/api/item/types";

const dependencies = vi.hoisted(() => ({
	fetcher: vi.fn(),
}));

const featureState = vi.hoisted(() => ({ relatedResources: true }));

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: () => featureState.relatedResources,
}));

vi.mock("@/context/Providers", () => ({
	useLastFetchedData: () => ({
		lastFetchedData: undefined,
		setLastFetchedData: vi.fn(),
	}),
}));

vi.mock("@/lib/utils", () => ({
	fetcher: dependencies.fetcher,
}));

vi.mock("@/components/features/items/Resource", () => ({
	default: ({ isLoading }: { isLoading: boolean }) => (
		<article
			data-testid={isLoading ? "related-skeleton" : "related-resource"}
		/>
	),
}));

import VectorRelations from "@/components/features/newlib/VectorRelations";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

async function flushPromises() {
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

describe("Similar Resources", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.useFakeTimers();
		featureState.relatedResources = true;
		dependencies.fetcher.mockReset();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.useRealTimers();
	});

	it("stays hidden and does not retry when recommendations are unavailable", async () => {
		let rejectRequest!: (reason: Error) => void;
		dependencies.fetcher.mockReturnValue(
			new Promise((_, reject) => {
				rejectRequest = reject;
			}),
		);

		await act(async () => {
			root.render(
				<SWRConfig
					value={{
						dedupingInterval: 0,
						provider: () => new Map(),
					}}
				>
					<VectorRelations
						item={{ key: "TESTITEM" } as Item}
						loading={false}
					/>
				</SWRConfig>,
			);
			await flushPromises();
		});

		const pending = container.querySelector("#vector-relations");
		expect(pending).not.toBeNull();
		expect(pending?.getAttribute("aria-busy")).toBe("true");
		expect(
			container.querySelectorAll('[data-testid="related-skeleton"]').length,
		).toBeGreaterThan(0);
		expect(dependencies.fetcher).toHaveBeenCalledTimes(1);

		await act(async () => {
			rejectRequest(new Error("Recommendations are unavailable"));
			await flushPromises();
		});

		expect(container.querySelector("#vector-relations")).toBeNull();

		await act(async () => {
			vi.advanceTimersByTime(60_000);
			await flushPromises();
		});

		expect(container.querySelector("#vector-relations")).toBeNull();
		expect(dependencies.fetcher).toHaveBeenCalledTimes(1);
	});

	function render(item: Item | undefined, loading: boolean) {
		return act(async () => {
			root.render(
				<SWRConfig
					value={{ dedupingInterval: 0, provider: () => new Map() }}
				>
					<VectorRelations item={item} loading={loading} />
				</SWRConfig>,
			);
			await flushPromises();
		});
	}

	it("renders nothing when the feature is off", async () => {
		featureState.relatedResources = false;
		dependencies.fetcher.mockResolvedValue({ hits: [{ key: "A" }] });

		await render({ key: "TESTITEM" } as Item, false);

		expect(container.querySelector("#vector-relations")).toBeNull();
		expect(dependencies.fetcher).not.toHaveBeenCalled();
	});

	it("shows skeleton cards while the item itself is still loading", async () => {
		await render(undefined, true);

		const block = container.querySelector("#vector-relations");
		expect(block?.getAttribute("aria-busy")).toBe("true");
		expect(
			container.querySelectorAll('[data-testid="related-skeleton"]').length,
		).toBeGreaterThan(0);
		expect(dependencies.fetcher).not.toHaveBeenCalled();
	});

	it("replaces the skeleton with the recommendations once they load", async () => {
		let resolveRequest!: (value: unknown) => void;
		dependencies.fetcher.mockReturnValue(
			new Promise((resolve) => {
				resolveRequest = resolve;
			}),
		);

		await render({ key: "TESTITEM" } as Item, false);
		expect(
			container.querySelectorAll('[data-testid="related-skeleton"]').length,
		).toBeGreaterThan(0);

		await act(async () => {
			resolveRequest({ hits: [{ key: "A" }, { key: "B" }] });
			await flushPromises();
		});

		const block = container.querySelector("#vector-relations");
		expect(block?.getAttribute("aria-busy")).toBe("false");
		expect(
			container.querySelectorAll('[data-testid="related-skeleton"]'),
		).toHaveLength(0);
		expect(
			container.querySelectorAll('[data-testid="related-resource"]'),
		).toHaveLength(2);
	});

	it("hides the block when the server has no recommendations", async () => {
		dependencies.fetcher.mockResolvedValue({ hits: [] });

		await render({ key: "TESTITEM" } as Item, false);

		expect(container.querySelector("#vector-relations")).toBeNull();
	});
});
