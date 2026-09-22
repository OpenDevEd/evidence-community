// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
	downloadsEnabled: true,
	citationsEnabled: true,
	exports: { ris: true, bibtex: true, atom: false },
}));

vi.mock("server-only", () => ({}));

vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
	useLocale: () => "en-GB",
}));

vi.mock("@/lib/actions", () => ({
	convertItem: vi.fn(async () => "TY  - JOUR"),
}));

// The downloads switch decides whether a reader sees the button. The RIS and
// BibTeX switches decide which formats the dialog offers.
vi.mock("@/context/LibraryConfigProvider", () => ({
	useLibraryConfig: () => ({
		exports: testState.exports,
		citations: { enabled: testState.citationsEnabled },
	}),
	useLibraryFeature: (feature: string) =>
		feature === "downloads" && testState.downloadsEnabled,
}));

import {
	DownloadButton,
	DownloadModal,
} from "@/components/features/newlib/DownloadModal";

(
	globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

describe("single-record download options", () => {
	let container: HTMLDivElement;
	let root: Root;

	async function renderModal(citationPath?: string) {
		await act(async () => {
			root.render(
				<DownloadModal
					isOpen
					onOpenChange={vi.fn()}
					onClose={vi.fn()}
					action={vi.fn(async () => "TY  - JOUR")}
					fileName="ABCD1234"
					citationPath={citationPath}
				/>,
			);
		});

		return Array.from(
			document.body.querySelectorAll('[role="option"]'),
		).map((option) => option.textContent ?? "");
	}

	beforeEach(() => {
		testState.downloadsEnabled = true;
		testState.citationsEnabled = true;
		testState.exports = { ris: true, bibtex: true, atom: false };
		localStorage.clear();
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => {
			root.unmount();
		});
		container.remove();
		localStorage.clear();
	});

	it("shows the download button when downloads are switched on", async () => {
		await act(async () => {
			root.render(
				<DownloadButton fileName="ABCD1234" itemData={{} as never}>
					Download
				</DownloadButton>,
			);
		});

		expect(container.querySelector("button")?.textContent).toBe("Download");
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

	it("offers RIS and BibTeX when both switches are on", async () => {
		const options = await renderModal();

		expect(options).toHaveLength(2);
		expect(options[0]).toContain("RIS");
		expect(options[0]).toContain(".ris");
		expect(options[1]).toContain("BibTeX");
		expect(options[1]).toContain(".bib");
	});

	it("offers only BibTeX when the RIS switch is off", async () => {
		testState.exports = { ris: false, bibtex: true, atom: false };

		const options = await renderModal();

		expect(options).toHaveLength(1);
		expect(options[0]).toContain("BibTeX");
	});

	it("offers only RIS when the BibTeX switch is off", async () => {
		testState.exports = { ris: true, bibtex: false, atom: false };

		const options = await renderModal();

		expect(options).toHaveLength(1);
		expect(options[0]).toContain("RIS");
	});

	it("offers formatted downloads with the saved citation style", async () => {
		localStorage.setItem("citation-style", JSON.stringify("vancouver"));
		await renderModal("/api/item/ABCD1234/export/citation");

		const citationSection = document.querySelector(
			'section[aria-label="itemCitationTitle"]',
		);
		expect(citationSection?.textContent).toContain("Vancouver");
		expect(citationSection?.textContent).toContain(
			"downloadFormattedCitation",
		);
		expect(citationSection?.textContent).toContain("downloadPlainCitation");
	});

	it("keeps formatted downloads available when reference-manager exports are off", async () => {
		testState.exports = { ris: false, bibtex: false, atom: false };
		const options = await renderModal("/api/exports/citation");

		expect(options).toHaveLength(0);
		expect(
			document.querySelector('section[aria-label="itemCitationTitle"]'),
		).not.toBeNull();
		expect(
			document.querySelector(
				'section[aria-label="referenceManagerFormats"]',
			),
		).toBeNull();
	});

	it("hides formatted downloads when citations are disabled", async () => {
		testState.citationsEnabled = false;
		const options = await renderModal("/api/item/ABCD1234/export/citation");

		expect(options).toHaveLength(2);
		expect(
			document.querySelector('section[aria-label="itemCitationTitle"]'),
		).toBeNull();
	});
});
