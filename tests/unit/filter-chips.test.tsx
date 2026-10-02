// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
// The download menu talks to the server; the chips do not.
vi.mock("@/lib/actions", () => ({ convertItem: vi.fn() }));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
	useFormatter: () => ({ number: (value: number) => String(value) }),
}));
vi.mock("@/i18n/routing", () => ({
	usePathname: () => "/lib",
	useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
	Link: ({ children }: { children: unknown }) => children,
}));

const libraryState = vi.hoisted(() => ({ topicsEnabled: true }));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		topics: { enabled: libraryState.topicsEnabled },
	}),
}));

const filters = {
	queryParams: {
		collections: [] as string[],
		institution: [] as string[],
		type: [] as string[],
		author: "",
		range: "",
	} as Record<string, unknown>,
	selectedCollections: [] as string[],
	collectionsData: undefined,
	handleClearFilters: vi.fn(),
	handleRangeChange: vi.fn(),
	handleAuthorSelect: vi.fn(),
	handleTypeSelect: vi.fn(),
	handleInstitutionSelect: vi.fn(),
	handleCheckboxChange: vi.fn(),
};

vi.mock("@/context/FiltersProvider", () => ({
	useFiltersContext: () => filters,
}));

import { FilterChips } from "@/components/features/resources/ResourcesView";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("the chips showing which filters are on", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		vi.clearAllMocks();
		filters.queryParams = {
			collections: [],
			institution: [],
			topics: [],
			type: [],
			author: "",
			range: "",
		};
		libraryState.topicsEnabled = true;
		filters.selectedCollections = [];
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	async function render() {
		await act(async () => {
			root.render(<FilterChips />);
		});
	}

	function clearButton() {
		return container.querySelector<HTMLButtonElement>(
			'button[aria-label="clearFiltersAriaLabel"]',
		);
	}

	it("offers nothing to clear when no filter is on", async () => {
		await render();

		expect(clearButton()).toBeNull();
	});

	it("ignores topic URL state while Topics are off", async () => {
		libraryState.topicsEnabled = false;
		filters.queryParams.topics = [
			"domains/1",
			"fields/2",
			"subfields/3",
			"T4",
		];
		await render();

		expect(clearButton()).toBeNull();
		expect(container.textContent).not.toContain("Topic");
	});

	it("writes a single year plainly", async () => {
		filters.queryParams.range = "2015-2015";
		await render();

		expect(container.textContent).toContain("2015");
		expect(container.textContent).not.toContain("2015–2015");
	});

	it("writes a span of years with both ends", async () => {
		filters.queryParams.range = "2010-2020";
		await render();

		expect(container.textContent).toContain("2010–2020");
	});

	it("writes an open-ended span from a starting year", async () => {
		filters.queryParams.range = "2010-";
		await render();

		expect(container.textContent).toContain("2010+");
	});

	it("writes an open-ended span up to an ending year", async () => {
		filters.queryParams.range = "-2020";
		await render();

		expect(container.textContent).toContain("–2020");
	});

	it("takes the year filter off again", async () => {
		filters.queryParams.range = "2010-2020";
		await render();

		const chip = container.querySelector("button");
		await act(async () => {
			chip?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		});

		expect(filters.handleRangeChange).toHaveBeenCalledWith(null, null);
	});

	it("clears every filter at once", async () => {
		filters.queryParams.author = "Ada Lovelace";
		await render();

		expect(container.textContent).toContain("Ada Lovelace");
		await act(async () => {
			clearButton()?.dispatchEvent(
				new MouseEvent("click", { bubbles: true }),
			);
		});

		expect(filters.handleClearFilters).toHaveBeenCalledOnce();
	});
});
