// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@/app/api/item/types";

const dependencies = vi.hoisted(() => ({
	fetcher: vi.fn(),
}));

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: () => true,
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
	default: () => <article data-testid="related-resource" />,
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

		expect(container.querySelector("#vector-relations")).toBeNull();
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
});
