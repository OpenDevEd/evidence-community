// @vitest-environment jsdom

import { createContext, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig, type Cache } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({
	bookmarks: 1,
	listRequests: 0,
	/** Holds list answers back until the test lets them through. */
	hold: null as Promise<void> | null,
}));

vi.mock("next/navigation", () => ({ usePathname: () => "/profile/reader-amina" }));
vi.mock("@/components/layout/navbar/ReaderSession", () => ({
	useReaderSession: () => ({ reader: { id: "reader-amina", name: "Amina", image: null } }),
}));
vi.mock("@/context/LibraryConfigProvider", () => ({ useLibraryFeature: () => true }));
vi.mock("@/context/FiltersProvider", () => ({
	useFiltersContext: () => ({ queryParams: { page: 1 }, handlePageChange: vi.fn() }),
}));
vi.mock("@/context/Providers", () => ({
	CacheContext: createContext({ cacheItems: () => undefined, getCachedItems: () => undefined }),
	useLastFetchedData: () => ({ setLastFetchedData: () => undefined }),
}));
vi.mock("@/lib/utils", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/utils")>()),
	fetcher: async (key: string) => {
		if (!key.startsWith("/user/items/")) return { bookmarks: {} };
		server.listRequests += 1;
		const bookmarks = server.bookmarks;
		await server.hold;
		return { items: [], totalItems: bookmarks, totalPages: 1, currentPage: 1 };
	},
}));

import { useItemsList } from "@/hooks/useItemsList";
import { useReaderData } from "@/hooks/useReaderData";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The reader's own list on their profile, and whether it shows its loading state. */
function ProfileList() {
	const { itemsData, isItemsLoading } = useItemsList({ id: "reader-amina" });
	return <p>{isItemsLoading ? "loading" : `${itemsData?.totalItems} bookmarked`}</p>;
}

/** What a bookmark or collection change calls once it has saved. */
function Controls() {
	const { refresh } = useReaderData();
	return <button onClick={() => void refresh()}>Changed</button>;
}

let container: HTMLDivElement;
let root: Root;
// A fresh SWR cache per test, so nothing carries over between them.
let cache: Cache;

function render(showList: boolean) {
	act(() => {
		root.render(
			<SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
				<Controls />
				{showList ? <ProfileList /> : null}
			</SWRConfig>,
		);
	});
}

const list = () => container.querySelector("p")?.textContent;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	cache = new Map() as unknown as Cache;
	Object.assign(server, { bookmarks: 1, listRequests: 0, hold: null });
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

describe("a reader's own list", () => {
	it("loads afresh when they come back to it after bookmarking elsewhere", async () => {
		render(true);
		await vi.waitFor(() => expect(list()).toBe("1 bookmarked"));

		// The reader leaves their profile, bookmarks another record, and comes back.
		render(false);
		server.bookmarks = 2;
		render(true);

		await vi.waitFor(() => expect(list()).toBe("2 bookmarked"));
		expect(server.listRequests).toBe(2);
	});

	it("keeps its rows, not a loading state, while a change made on the same page reloads it", async () => {
		render(true);
		await vi.waitFor(() => expect(list()).toBe("1 bookmarked"));

		let release = () => undefined as void;
		server.hold = new Promise((resolve) => (release = resolve));
		server.bookmarks = 2;
		act(() => {
			container.querySelector("button")!.click();
		});
		await vi.waitFor(() => expect(server.listRequests).toBe(2));
		expect(list()).toBe("1 bookmarked");

		await act(async () => release());
		await vi.waitFor(() => expect(list()).toBe("2 bookmarked"));
	});
});
