// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/components/admin/admin-api", async (original) => ({
	...(await original<typeof import("@/components/admin/admin-api")>()),
	getAdminItems: vi.fn(async () => ({ hasMore: false, items: [], nextCursor: null })),
}));

import { useAdminItemList } from "@/components/admin/useAdminItemList";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;
let list: ReturnType<typeof useAdminItemList>;
function Probe() {
	list = useAdminItemList([]);
	return null;
}
const show = (address: string) => act(async () => root.render(<NuqsTestingAdapter searchParams={address}><Probe /></NuqsTestingAdapter>));

beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });

it("reads the record view from the address", async () => {
	await show("?search=teacher+coaching&sort=title&direction=asc&review=pending");
	expect(list.filters).toMatchObject({ query: "teacher coaching", sort: "title", sortDirection: "asc", reviewQueue: true, filters: [] });
});

it("builds each change on the one before it when two are made in one moment", async () => {
	await show("?search=tea");
	await act(async () => {
		list.setFilters((view) => ({ ...view, sort: "title" }));
		list.setFilters((view) => ({ ...view, sortDirection: "asc" }));
		list.setFilters((view) => ({ ...view, query: `${view.query}c` }));
		list.setFilters((view) => ({ ...view, query: `${view.query}h` }));
	});
	expect(list.filters).toMatchObject({ query: "teach", sort: "title", sortDirection: "asc" });
});
