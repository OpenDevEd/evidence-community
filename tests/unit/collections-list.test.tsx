// @vitest-environment jsdom

import { act, createContext } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Collection } from "@/app/api/collections/types";
import { buildHierarchy } from "@/lib/collections";
import { loadSearchParams } from "@/lib/searchParams";
import messages from "@/messages/en-GB.json";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/actions", () => ({ convertItem: vi.fn() }));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: keyof typeof messages.ui) => messages.ui[key],
}));
vi.mock("@/context/Providers", () => ({
	CacheContext: createContext({ globalExpanded: {}, accordionGlobalExpanded: null }),
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: (feature: string) => feature === "collections",
	useLibraryConfig: () => ({
		filters: {
			collectionsExpanded: true,
			years: { enabled: false },
			institution: { mode: "hidden", label: "Institutions" },
		},
		institutions: [],
		topics: { enabled: false },
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
