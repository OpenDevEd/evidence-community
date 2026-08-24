// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
	useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
}));
vi.mock("swr", () => ({ default: () => ({ data: undefined, isLoading: false }) }));
// The citation card reaches the shared fetch helper, which drags the signed-in
// app in behind it. These tests only need the rendered citation.
vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn(async () => true) }));
vi.mock("@/components/features/items/Resource", () => ({
	default: ({ itemKey }: { itemKey?: string }) => (
		<article aria-label={`Publication card ${itemKey}`} />
	),
}));

import { AIMarkdown } from "@/components/features/markdown/Markdown";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
	true;

describe("what an AI answer shows the reader", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	async function render(answer: string) {
		await act(async () => {
			root.render(<AIMarkdown>{answer}</AIMarkdown>);
		});
		return container;
	}

	it("opens the cited PDF at the cited page", async () => {
		await render(
			"Radio lessons reached rural schools. [PAGE /lib/ABCD1234/download/PDF00001 — 12 PAGE/]",
		);

		const citation = container.querySelector("a");
		expect(citation?.getAttribute("href")).toBe(
			"/lib/ABCD1234/download/PDF00001#page=12",
		);
		expect(citation?.textContent).toContain("12");
		expect(container.textContent).toContain("Source");
		expect(citation?.getAttribute("aria-label")).toBe(
			"Open citation source at page 12",
		);
		expect(container.textContent).not.toContain("PAGE/");
		expect(container.textContent).not.toContain("/download/");
	});

	it("shows the page but no citation link when the source is unknown", async () => {
		await render("A claim from an unknown file. [PAGE notes.pdf — 3 PAGE/]");

		expect(container.querySelector("a")).toBeNull();
		expect(container.textContent).toContain("Source");
		expect(container.textContent).toContain("3");
		expect(
			container.querySelector(
				'[aria-label="Citation source unavailable at page 3"]',
			),
		).not.toBeNull();
	});

	it("never turns an invented citation target into a citation link", async () => {
		await render(
			"An unsupported claim. [PAGE https://example.org/evil.pdf — 3 PAGE/]",
		);

		expect(container.querySelector('a[href*="#page="]')).toBeNull();
		expect(
			container.querySelector('a[href^="/lib/"]'),
		).toBeNull();
	});

	it("keeps a titled publication link as a link, not a card", async () => {
		await render("See [Teaching by radio](/lib/ABCD1234) for the method.");

		const link = container.querySelector("a");
		expect(link?.getAttribute("href")).toBe("/lib/ABCD1234");
		expect(link?.textContent).toBe("Teaching by radio");
		expect(
			container.querySelector("[aria-label^='Publication card']"),
		).toBeNull();
	});

	it("repairs a link the assistant wrote without its leading slash", async () => {
		await render("See [the study](lib/ABCD1234).");

		expect(
			container.querySelector('a[href="/lib/ABCD1234"]'),
		).not.toBeNull();
	});

	it("shows unfinished formatting cleanly while the answer streams", async () => {
		await act(async () => {
			root.render(
				<AIMarkdown isAnimating>
					{"Radio reached **rural sch"}
				</AIMarkdown>,
			);
		});

		expect(container.textContent).toContain("Radio reached");
		expect(container.textContent).not.toContain("**");
	});

	it("shows a full card only where the assistant asked for one", async () => {
		await render("[RESOURCE /lib/ABCD1234 RESOURCE/]");

		expect(
			container.querySelector("[aria-label='Publication card ABCD1234']"),
		).not.toBeNull();
		expect(container.textContent).not.toContain("RESOURCE");
	});
});
