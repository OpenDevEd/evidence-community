// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import useSWR, { SWRConfig, type Cache } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const server = vi.hoisted(() => ({ bookmarks: 1, listRequests: 0 }));

vi.mock("@/components/layout/navbar/ReaderSession", () => ({
	useReaderSession: () => ({ reader: { id: "reader-amina", name: "Amina", image: null } }),
}));
vi.mock("@/context/LibraryConfigProvider", () => ({ useLibraryFeature: () => true }));
vi.mock("@/lib/utils", () => ({
	fetcher: async (key: string) => {
		if (key.startsWith("/user/items/")) {
			server.listRequests += 1;
			return { totalItems: server.bookmarks };
		}
		return { bookmarks: {}, collections: [], itemCollections: {} };
	},
}));

import { useReaderData } from "@/hooks/useReaderData";
import { fetcher } from "@/lib/utils";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** A reader's list cached the way the profile caches it: never refetched just for being stale. */
function ProfileList() {
	const { data } = useSWR<{ totalItems: number }>("/user/items/reader-amina?page=0", fetcher, {
		revalidateIfStale: false,
		revalidateOnFocus: false,
		keepPreviousData: true,
	});
	return <p>{data ? `${data.totalItems} bookmarked` : "loading"}</p>;
}

/** What a bookmark or collection change calls once it has saved. */
function Controls() {
	const { refresh } = useReaderData();
	return <button onClick={() => void refresh()}>Changed</button>;
}

function change() {
	act(() => {
		container.querySelector("button")!.click();
	});
}

const list = () => container.querySelector("p")?.textContent;

let container: HTMLDivElement;
let root: Root;

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

// A fresh SWR cache per test, so nothing carries over between them.
let cache: Cache;

beforeEach(() => {
	container = document.createElement("div");
	document.body.append(container);
	root = createRoot(container);
	cache = new Map() as unknown as Cache;
	Object.assign(server, { bookmarks: 1, listRequests: 0 });
});

afterEach(() => {
	act(() => root.unmount());
	container.remove();
});

async function settle() {
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

describe("after a bookmark changes", () => {
	it("loads a reader list seen earlier afresh when its page opens again", async () => {
		render(true);
		await vi.waitFor(() => expect(list()).toBe("1 bookmarked"));

		// The reader leaves their profile, bookmarks another record, and comes back.
		render(false);
		server.bookmarks = 2;
		change();
		await settle();
		render(true);

		await vi.waitFor(() => expect(list()).toBe("2 bookmarked"));
		expect(server.listRequests).toBe(2);
	});

	it("reloads a list on screen without blanking it first", async () => {
		render(true);
		await vi.waitFor(() => expect(list()).toBe("1 bookmarked"));
		server.bookmarks = 2;
		change();
		expect(list()).toBe("1 bookmarked");
		await vi.waitFor(() => expect(list()).toBe("2 bookmarked"));
	});
});
