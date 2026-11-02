// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
	useFormatter: () => ({ number: (value: number) => String(value) }),
}));
vi.mock("@/context/FiltersProvider", () => ({
	useFiltersContext: () => ({ facetTotals: undefined }),
}));
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryFeature: () => true,
}));
// An option's figures measure their text, which jsdom can't do. The list around them is what's under test.
vi.mock("@/components/features/collections/FacetOption", () => ({
	FacetOption: ({ label }: { label: string }) => label,
}));

import { YearFilter } from "@/components/features/collections/YearFilter";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it("keeps the year list open when the page scrolls", async () => {
	// Moving through the list with the arrow keys scrolls the page, which must not shut the list part way down it.
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	const year = () => container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
	try {
		await act(async () => {
			root.render(<YearFilter range="2020" onRangeChange={vi.fn()} years={["2025", "2024"]} />);
		});
		await act(async () => year().focus());
		// NextUI loads its animations when a list opens, which must not finish after the test has ended.
		await vi.dynamicImportSettled();
		expect(year().getAttribute("aria-expanded")).toBe("true");

		await act(async () => {
			document.dispatchEvent(new Event("scroll"));
		});
		expect(year().getAttribute("aria-expanded")).toBe("true");
	} finally {
		await act(async () => root.unmount());
		container.remove();
	}
});
