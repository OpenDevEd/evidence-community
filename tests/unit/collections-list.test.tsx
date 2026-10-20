// @vitest-environment jsdom

import { act, createContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection } from "@/app/api/collections/types";
import { buildHierarchy } from "@/lib/collections";
import { loadSearchParams } from "@/lib/searchParams";
import messages from "@/messages/en-GB.json";

// What the library offers, set per test: collections, its sources, and topics.
const library = vi.hoisted(() => ({
	collections: true,
	topics: false,
	sources: [] as { key: string; name: string }[],
	chosenSources: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions", () => ({ convertItem: vi.fn() }));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: keyof typeof messages.ui) => messages.ui[key],
	useFormatter: () => ({ number: (value: number) => String(value) }),
}));
// The sidebar always lives inside the app's filter state; these tests need only its shape.
vi.mock("@/context/FiltersProvider", async () => {
	const { loadSearchParams } = await import("@/lib/searchParams");
	return {
		useFiltersContext: () => ({
			facetTotals: undefined,
			facetDistribution: { sources: { "openalex-climate": 4, "openalex-health": 2 } },
			queryParams: loadSearchParams({ sources: library.chosenSources }),
			sources: library.sources,
			handleSourceSelect: vi.fn(),
			handleTypeSelect: vi.fn(),
			handleAuthorSelect: vi.fn(),
		}),
	};
});
vi.mock("@/context/Providers", () => ({
	CacheContext: createContext({ globalExpanded: {}, accordionGlobalExpanded: null }),
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: (feature: string) => feature === "collections" && library.collections,
	useLibraryConfig: () => ({
		filters: {
			collectionsExpanded: true,
			years: { enabled: false },
			institution: { mode: "hidden", label: "Institutions" },
			sources: { enabled: true, label: "Searches" },
		},
		institutions: [],
		topics: { enabled: library.topics },
	}),
}));

vi.mock("@/lib/topics/client", () => ({
	useTopicTree: () => ({
		data: { nodes: [{ id: "domains/2", name: "Social Sciences", parent: null }, { id: "fields/20", name: "Economics", parent: "domains/2" }] },
		error: undefined,
		mutate: vi.fn(),
	}),
}));

import CollectionsList from "@/components/features/collections/CollectionsList";

const timestamp = new Date("2026-07-28T00:00:00Z");
function collection(key: string, parentCollection: string | null): Collection {
	return {
		key, parentCollection, name: key, sourceConnectionKey: "native",
		sourceRecordKey: key, revision: 1, sortOrder: 1024, numCollections: 0,
		numItems: 1, deleted: 0, deletedAt: null, relations: null,
		createdAt: timestamp, updatedAt: timestamp,
	};
}
const hierarchy = buildHierarchy([collection("Topics", null), collection("Schools", "Topics")]);
const collections = [hierarchy[0], ...hierarchy[0].children!];

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("collection choices for filtered results", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
		vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	});

	async function render(counts: Record<string, number>) {
		await act(async () => root.render(<CollectionsList
			data={{ collections }} hierarchy={hierarchy}
			facetDistribution={{ collectionsAncestry: counts }}
			selectedCollections={[]} range="" queryParams={loadSearchParams({})}
			handleCheckboxChange={vi.fn()} handleCountrySelect={vi.fn()}
			handleRangeChange={vi.fn()} handleInstitutionSelect={vi.fn()}
			handleTopicsChange={vi.fn()}
		/>));
	}

	it.each<Record<string, number>>([{}, { Topics: 1 }, { Unconfigured: 1 }])(
		"reports no collection choices for counts %j",
		async (counts) => {
			await render(counts);
			expect(container.querySelector('input[type="checkbox"]')).toBeNull();
			// Read the localized message so the assertion protects the empty-state
			// branch rather than a particular wording.
			expect(container.textContent).toContain(messages.ui.noFacetsFound);
		},
	);

	it("replaces an available collection with the empty state when the filter has no child matches", async () => {
		await render({ Topics: 1, Schools: 1 });
		expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
		expect(container.textContent).toContain("Schools");
		await render({ Topics: 1 });
		expect(container.querySelector('input[type="checkbox"]')).toBeNull();
		expect(container.textContent).toContain(messages.ui.noFacetsFound);
	});
});

describe("what takes the place under the filters", () => {
	let container: HTMLDivElement;
	let root: Root;
	beforeEach(() => {
		vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
		vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
		Object.assign(library, { collections: false, topics: true, sources: [], chosenSources: [] });
	});
	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
		Object.assign(library, { collections: true, topics: false, sources: [], chosenSources: [] });
	});

	const climate = { key: "openalex-climate", name: "Climate" };
	const health = { key: "openalex-health", name: "Health" };

	async function render() {
		await act(async () => root.render(<CollectionsList
			data={{ collections }} hierarchy={hierarchy}
			facetDistribution={{ collectionsAncestry: { Topics: 1, Schools: 1 }, topicAncestors: { "domains/2": 3, "fields/20": 3 } }}
			selectedCollections={[]} range="" queryParams={loadSearchParams({})}
			handleCheckboxChange={vi.fn()} handleCountrySelect={vi.fn()}
			handleRangeChange={vi.fn()} handleInstitutionSelect={vi.fn()}
			handleTopicsChange={vi.fn()}
		/>));
	}
	/** The names of the choices in the tree under the filters. */
	const treeChoices = () =>
		[...container.querySelectorAll('input[type="checkbox"]')].map((box) => box.closest("label")?.textContent ?? "");

	it("gives it to the sources over the topics, in a section under the library's name for them", async () => {
		library.sources = [climate, health];
		await render();
		expect(treeChoices().some((choice) => choice.includes("Climate"))).toBe(true);
		expect(treeChoices().some((choice) => choice.includes("Health"))).toBe(true);
		expect(treeChoices().some((choice) => choice.includes("Economics"))).toBe(false);
		expect(container.textContent).toContain("Searches");
	});

	it("keeps it for the collections, and offers the sources among the filters", async () => {
		library.collections = true;
		library.sources = [climate, health];
		await render();
		expect(treeChoices().some((choice) => choice.includes("Schools"))).toBe(true);
		expect(treeChoices().some((choice) => choice.includes("Climate"))).toBe(false);
		expect([...container.querySelectorAll("label")].some((label) => label.textContent === "Searches")).toBe(true);
	});

	it("leaves it to the topics when the library has one source, which would filter nothing", async () => {
		library.sources = [climate];
		await render();
		expect(treeChoices().some((choice) => choice.includes("Economics"))).toBe(true);
		expect(container.textContent).not.toContain("Searches");
	});
});
