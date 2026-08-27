// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
	downloadsEnabled: true,
}));

vi.mock("server-only", () => ({}));

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
}));

vi.mock("@/lib/actions", () => ({
	convertItem: vi.fn(async () => "TY  - JOUR"),
}));

// The library has no whole-library export addresses at all. Only the
// downloads switch decides what a reader sees.
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		exports: { ris: false, bibtex: false, atom: false },
	}),
	useLibraryFeature: (feature: string) =>
		feature === "downloads" && testState.downloadsEnabled,
}));

import {
	DownloadButton,
	DownloadModal,
} from "@/components/features/newlib/DownloadModal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("single-record download options", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		testState.downloadsEnabled = true;
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
	});

	it("keeps the download button when no export addresses are configured", async () => {
		await act(async () => {
			root.render(
				<DownloadButton fileName="ABCD1234" itemData={{} as never}>
					Download
				</DownloadButton>,
			);
		});

		expect(container.querySelector("button")?.textContent).toBe(
			"Download",
		);
	});

	it("hides the download button when downloads are switched off", async () => {
		testState.downloadsEnabled = false;

		await act(async () => {
			root.render(
				<DownloadButton fileName="ABCD1234" itemData={{} as never}>
					Download
				</DownloadButton>,
			);
		});

		expect(container.querySelector("button")).toBeNull();
	});

	it("offers RIS and BibTeX without any export address", async () => {
		await act(async () => {
			root.render(
				<DownloadModal
					isOpen
					onOpenChange={vi.fn()}
					onClose={vi.fn()}
					action={vi.fn(async () => "TY  - JOUR")}
					fileName="ABCD1234"
				/>,
			);
		});

		const options = Array.from(
			document.body.querySelectorAll('[role="option"]'),
		).map((option) => option.textContent ?? "");

		expect(options).toHaveLength(2);
		expect(options[0]).toContain("RIS");
		expect(options[0]).toContain(".ris");
		expect(options[1]).toContain("BibTeX");
		expect(options[1]).toContain(".bib");
	});
});
