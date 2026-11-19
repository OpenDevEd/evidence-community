// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { SWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/admin/admin-api", async (original) => ({
	...(await original<typeof import("@/components/admin/admin-api")>()),
	getAdminReviewCount: vi.fn(async () => 3),
}));
vi.mock("@/components/admin/AdminCollectionCatalogue", () => ({ AdminCollectionCatalogue: () => <p>Collection catalogue</p> }));

import { AdminNavigation } from "@/components/admin/AdminNavigation";
import { AdminSessionProvider } from "@/components/admin/AdminSessionProvider";
import { DigestsPage, digestShowFor, recordStateFor, type DigestShow } from "@/components/admin/admin-digests-page";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;
const pressed = () => [...container.querySelectorAll('button[aria-pressed="true"]')].map((element) => element.textContent);
const button = (name: string) => [...container.querySelectorAll("button")].find((element) => element.textContent?.startsWith(name));
const press = (name: string) => act(async () => { button(name)!.click(); });

const chose = { kind: vi.fn(), review: vi.fn(), state: vi.fn(), open: vi.fn(), show: vi.fn() };
async function show(page: { digests: boolean; show?: DigestShow; reviewQueue?: boolean }) {
	const nothing = () => {};
	await act(async () => root.render(
		<SWRConfig value={{ provider: () => new Map() }}>
			<AdminSessionProvider session={{ role: "editor", userId: "user_editor", name: "Gugulethu Dube", image: null, doiProviders: { crossref: true, zenodo: true }, defaultLicence: "cc-by-4.0", defaultFileAccess: null }}>
				<DigestsPage value={{ selected: page.digests, waiting: 2, show: page.show ?? "all", onOpen: chose.open, onShow: chose.show }}>
					<AdminNavigation
						kind={page.reviewQueue ? null : "all"} onSelectKind={chose.kind} reviewQueue={page.reviewQueue ?? false} onSelectReviewQueue={chose.review}
						state="deleted" onSelectState={chose.state} source={null} sources={[]} collection={null} isBusy={false}
						onCreateCollection={nothing} onDeleteCollection={nothing} onEditCollection={nothing} onMoveCollection={nothing} onRestoreCollection={nothing}
						onSelectCollection={nothing} onOpenSourceSync={nothing} onSelectSource={nothing}
					/>
				</DigestsPage>
			</AdminSessionProvider>
		</SWRConfig>,
	));
	await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

beforeEach(() => { container = document.createElement("div"); document.body.append(container); root = createRoot(container); });
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); });

describe("the admin's navigation", () => {
	it("chooses the page in the Kind list, with what waits for review beside the queue and the digests", async () => {
		await show({ digests: false });
		expect(pressed()).toEqual(["All", "Deleted"]);
		expect(button("Review queue")!.textContent).toBe("Review queue3");
		expect(button("Digests")!.textContent).toBe("Digests2");
		await press("Digests");
		expect(chose.open).toHaveBeenCalledTimes(1);
		await press("Review queue");
		expect(chose.review).toHaveBeenCalledTimes(1);
	});

	it("lists the states digests have while the digests are the page, and nothing that only narrows records", async () => {
		await show({ digests: true, show: "review" });
		expect(pressed()).toEqual(["Digests2", "In review"]);
		const text = container.textContent ?? "";
		expect(text).toContain("Digest state");
		for (const gone of ["Record state", "Deleted", "Edited", "Sources", "Collections"]) expect(text).not.toContain(gone);
		await press("Published");
		expect(chose.show).toHaveBeenCalledWith("published");
		expect(chose.state).not.toHaveBeenCalled();
		// A kind of record leaves the digests.
		await press("Created");
		expect(chose.kind).toHaveBeenCalledWith("created");
	});

	it("keeps the state across pages where both have it, and shows everything where only one does", () => {
		expect([digestShowFor("draft"), digestShowFor("published"), digestShowFor("edited"), digestShowFor("deleted"), digestShowFor("all"), digestShowFor(null)]).toEqual(["draft", "published", "all", "all", "all", "all"]);
		expect([recordStateFor("draft"), recordStateFor("published"), recordStateFor("review"), recordStateFor("all")]).toEqual(["draft", "published", "all", "all"]);
	});
});
