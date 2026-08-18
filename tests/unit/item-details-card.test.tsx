// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Item } from "@/app/api/item/types";

const testState = vi.hoisted(() => ({
	citationsShowUrl: false,
	collectionsEnabled: false,
	swrResult: {
		data: undefined as { citation: string | null } | undefined,
		isLoading: false,
	},
}));

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({
	default: () => ({ auth: vi.fn(), handlers: {} }),
}));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("nuqs", () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock("@/i18n/routing", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("next-intl", () => ({
	useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
	useTranslations: () => (key: string) => key,
}));

vi.mock("swr", () => ({
	default: () => testState.swrResult,
}));

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		identity: { baseUrl: "https://library.example.org" },
		citations: { showUrl: testState.citationsShowUrl },
	}),
	useLibraryFeature: (feature: string) =>
		feature === "collections" && testState.collectionsEnabled,
}));

import {
	ItemCitation,
	ItemCollections,
	ItemDetails,
	LoadingContext,
} from "@/components/features/newlib/ItemPage";
import { ItemHeaderYear } from "@/components/features/newlib/ItemHeader";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("public item empty sections", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		testState.citationsShowUrl = false;
		testState.collectionsEnabled = false;
		testState.swrResult = { data: undefined, isLoading: false };
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	it("does not show a calendar icon when the record has no year", async () => {
		await act(async () => {
			root.render(<ItemHeaderYear year={null} />);
		});

		expect(container.querySelector("svg")).toBeNull();
		expect(container.textContent).toBe("");
	});

	it("shows the year and calendar together when a year exists", async () => {
		await act(async () => {
			root.render(<ItemHeaderYear year="2026" />);
		});

		expect(container.textContent).toBe("2026");
		expect(container.querySelectorAll("svg")).toHaveLength(1);
	});

	it("does not show citation loading after the server returns no citation", async () => {
		testState.swrResult = {
			data: { citation: null },
			isLoading: false,
		};

		await act(async () => {
			root.render(
				<ItemCitation
					item={
						{
							key: "REPORT01",
							title: "A report without citation support",
							citation: "<div>Loading...</div>",
						} as Item
					}
				/>,
			);
		});

		expect(container.textContent).not.toContain("itemCitationTitle");
		expect(container.querySelector('[data-loaded="false"]')).toBeNull();
	});

	it("shows a citation returned by the server", async () => {
		testState.swrResult = {
			data: { citation: "A useful citation." },
			isLoading: false,
		};

		await act(async () => {
			root.render(
				<ItemCitation
					item={{ key: "REPORT01", title: "A report" } as Item}
				/>,
			);
		});

		expect(container.textContent).toContain("itemCitationTitle");
		expect(container.textContent).toContain("A useful citation.");
	});

	it("adds the public item URL when citation URLs are enabled", async () => {
		testState.citationsShowUrl = true;
		testState.swrResult = {
			data: { citation: "A useful citation." },
			isLoading: false,
		};

		await act(async () => {
			root.render(
				<ItemCitation
					item={{ key: "REPORT01", title: "A report" } as Item}
				/>,
			);
		});

		const publicLink = container.querySelector("a");
		expect(publicLink?.href).toBe(
			"https://library.example.org/lib/REPORT01",
		);
		expect(container.textContent).toContain(
			"Available at https://library.example.org/lib/REPORT01.",
		);
	});

	it("does not show Collections when none can be displayed", async () => {
		testState.collectionsEnabled = true;

		await act(async () => {
			root.render(
				<ItemCollections
					item={
						{
							collectionsData: [
								{
									key: "TOPLEVEL",
									name: "Top-level collection",
									title: "Topics",
									originalFacet: undefined,
								},
							],
						} as Item
					}
				/>,
			);
		});

		expect(container.textContent).not.toContain("itemTopicsCollectionsTitle");
	});

	it("shows a public child collection", async () => {
		testState.collectionsEnabled = true;

		await act(async () => {
			root.render(
				<ItemCollections
					item={
						{
							collectionsData: [
								{
									key: "CHILD",
									name: "Public child",
									title: "Topics",
									originalFacet: "TOPLEVEL",
									ancestry: ["TOPLEVEL"],
								},
							],
						} as Item
					}
				/>,
			);
		});

		expect(container.textContent).toContain("itemTopicsCollectionsTitle");
		expect(container.textContent).toContain("Public child");
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	it("does not appear when the record has no publication details", async () => {
		await act(async () => {
			root.render(
				<LoadingContext.Provider value={{ loading: false }}>
					<ItemDetails
						item={
							{
								itemType: "Report",
								key: "REPORT01",
								title: "A report with no extra details",
								url: "https://library.example.org/lib/REPORT01",
							} as Item
						}
					/>
				</LoadingContext.Provider>,
			);
		});

		expect(container.textContent).not.toContain(
			"itemPublicationDetailsTitle",
		);
	});
});
