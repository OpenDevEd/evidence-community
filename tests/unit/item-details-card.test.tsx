// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Citations, CitationData, FormattedCitation } from "@/lib/citation-formats";
import type { Item } from "@/app/api/item/types";

const testState = vi.hoisted(() => ({
	citationsEnabled: true,
	citationsShowUrl: false,
	collectionsEnabled: false,
	extraResult: { data: undefined as FormattedCitation | undefined, isLoading: false },
	swrResult: {
		data: undefined as
			| { citations: Citations | null; record?: CitationData }
			| undefined,
		isLoading: false,
	},
}));

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ back: vi.fn() }) }));
vi.mock("nuqs", () => ({ useQueryState: () => [null, vi.fn()] }));
vi.mock("@/i18n/routing", () => ({
	Link: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("next-intl", () => ({
	useLocale: () => "en-GB",
	useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
	useTranslations: () => (key: string) => key,
}));

vi.mock("swr", () => ({
	default: (key: unknown) => {
		if (Array.isArray(key) && key[0] === "citations")
			return testState.swrResult;
		if (Array.isArray(key) && key[0] === "citation-style")
			return testState.extraResult;
		if (key === "citation-styles")
			return {
				data: [
					{
						id: "nature",
						label: "Nature",
						asset: "/citation-styles/nature.json.gz",
					},
				],
			};
		return { data: undefined, isLoading: false };
	},
}));

vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		identity: { baseUrl: "https://library.example.org" },
		localization: {
			locales: ["en-GB"],
			localePriority: ["en-GB"],
			defaultLocale: "en-GB",
		},
		citations: {
			enabled: testState.citationsEnabled,
			showUrl: testState.citationsShowUrl,
		},
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

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("public item empty sections", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
		Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
		localStorage.clear();
		testState.extraResult = { data: undefined, isLoading: false };
		testState.citationsEnabled = true;
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

	it("never renders the citation row when citations are disabled", async () => {
		testState.citationsEnabled = false;
		testState.swrResult = { data: undefined, isLoading: true };

		await act(async () => {
			root.render(
				<ItemCitation
					item={{ key: "REPORT01", title: "A report" } as Item}
				/>,
			);
		});

		expect(container.textContent).not.toContain("itemCitationTitle");
		expect(container.querySelector("[data-citation-state]")).toBeNull();
	});

	it("shows citation loading while citation formatting is pending", async () => {
		testState.swrResult = { data: undefined, isLoading: true };

		await act(async () => {
			root.render(
				<ItemCitation
					item={{ key: "REPORT01", title: "A report" } as Item}
				/>,
			);
		});

		expect(container.textContent).toContain("itemCitationTitle");
		expect(
			container.querySelector('[data-citation-state="loading"]'),
		).not.toBeNull();
	});

	it("does not show citation loading after the server returns no citation", async () => {
		testState.swrResult = {
			data: { citations: null },
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
		expect(container.querySelector("[data-citation-state]")).toBeNull();
	});

	it("shows a citation returned by the server", async () => {
		testState.swrResult = {
			data: {
				citations: {
					apa: { text: "A useful citation.", html: null },
					harvard: { text: "Harvard reference.", html: null },
					chicago: { text: "Chicago reference.", html: null },
					mla: { text: "MLA reference.", html: null },
					vancouver: { text: "Vancouver reference.", html: null },
					bibtex: { text: "@misc{el_REPORT01, title={A report}}", html: null },
				},
			},
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

	it("retains citation text while a saved style changes and restores that style on remount", async () => {
		const item = { key: "REPORT01", title: "A report" } as Item;
		testState.swrResult = {
			data: {
				citations: {
					apa: { text: "The original citation.", html: null },
					harvard: { text: "Harvard.", html: null },
					chicago: { text: "Chicago.", html: null },
					mla: { text: "MLA.", html: null },
					vancouver: { text: "Vancouver.", html: null },
					bibtex: { text: "BibTeX.", html: null },
				},
				record: {
					id: "REPORT01",
					type: "report",
					title: "A report",
					"citation-key": "REPORT01",
				},
			},
			isLoading: false,
		};
		await act(async () => root.render(<ItemCitation item={item} />));
		expect(container.textContent).toContain("The original citation.");

		testState.extraResult = { data: undefined, isLoading: true };
		await act(async () => {
			localStorage.setItem("citation-style", JSON.stringify("nature"));
			window.dispatchEvent(
				new StorageEvent("storage", { key: "citation-style" }),
			);
		});
		expect(
			container.querySelector(
				'button[aria-label="citationStyle: Nature"]',
			),
		).not.toBeNull();
		expect(container.textContent).toContain("The original citation.");
		expect(
			container.querySelector('[role="status"]:not([aria-hidden="true"])'),
		).toBeNull();
		expect(
			container.querySelector<HTMLButtonElement>(
				'button[aria-label="copyCitation"]',
			)?.disabled,
		).toBe(true);

		testState.extraResult = {
			data: { text: "The Nature citation.", html: "<i>The Nature citation.</i>" },
			isLoading: false,
		};
		await act(async () => root.render(<ItemCitation item={item} />));
		expect(container.textContent).toContain("The Nature citation.");
		expect(container.textContent).not.toContain("The original citation.");
		expect(
			container.querySelector<HTMLButtonElement>(
				'button[aria-label="copyCitation"]',
			)?.disabled,
		).toBe(false);

		await act(async () => root.unmount());
		root = createRoot(container);
		await act(async () => root.render(<ItemCitation item={item} />));
		expect(
			container.querySelector(
				'button[aria-label="citationStyle: Nature"]',
			),
		).not.toBeNull();
		expect(container.textContent).toContain("The Nature citation.");
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

		expect(container.textContent).not.toContain(
			"itemTopicsCollectionsTitle",
		);
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
		localStorage.clear();
		Reflect.deleteProperty(document, "fonts");
		vi.unstubAllGlobals();
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
