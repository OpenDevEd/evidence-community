// @vitest-environment jsdom

import { act } from "react";
import Link from "next/link";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl", async () => {
	const english = await (await import("../helpers/next-intl-english")).englishIntl();
	const byKey = (key: string) => key;
	return {
		useTranslations: (namespace: string) => (namespace === "toolActivity" ? english.useTranslations(namespace) : byKey),
		useFormatter: () => ({ dateTime: (value: Date) => value.toISOString() }),
	};
});
vi.mock("swr", () => ({ default: () => ({ data: undefined, isLoading: false }) }));
// The citation card reaches the shared fetch helper, which drags the signed-in
// app in behind it. These tests only need the rendered citation.
vi.mock("@/lib/actions", () => ({ areLinksValid: vi.fn(async () => true) }));
vi.mock("@/components/features/items/Resource", () => ({
	default: ({ itemKey }: { itemKey?: string }) => (
		<article aria-label={`Publication card ${itemKey}`} />
	),
}));

import { AIMarkdown, MarkdownExcerpt } from "@/components/features/markdown/Markdown";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

const config = projectPublicLibraryConfig(libraryConfigSchema.parse(minimalLibraryConfig));
/** The PDFs the conversation has read, by file name, as the chat hands them to an answer. */
const READ_PDFS = { "radio-report.pdf": "/lib/ABCD1234/download/PDF00001" };

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

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
	});

	async function render(answer: string, pdfSources: Record<string, string> = READ_PDFS) {
		await act(async () => {
			root.render(
				<LibraryConfigProvider config={config}>
					<AIMarkdown pdfSources={pdfSources}>{answer}</AIMarkdown>
				</LibraryConfigProvider>,
			);
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

	it("opens each page of a citation that packs several pages", async () => {
		await render(
			"Screened 3,010 records. [PAGE /lib/ABCD1234/download/PDF00001 — 7 PAGE/, PAGE /lib/ABCD1234/download/PDF00001 — 8 PAGE/].",
		);

		expect(
			[...container.querySelectorAll("a")].map((link) =>
				link.getAttribute("href"),
			),
		).toEqual([
			"/lib/ABCD1234/download/PDF00001#page=7",
			"/lib/ABCD1234/download/PDF00001#page=8",
		]);
		expect(container.textContent).not.toContain("PAGE");
	});

	it("opens the cited page when the model drops the opening PAGE marker", async () => {
		// From an AIED answer on Haiku 5.5. A plain bracket nearby must stay text.
		await render(
			"Human feedback stayed stronger for argument development [/lib/27BGDU89/download/IUA7YXN9 — 1 PAGE/]. " +
				"Later rounds agreed [/lib/27BGDU89/download/IUA7YXN9 — 6 PAGE/] [/lib/27BGDU89/download/IUA7YXN9 — 7 PAGE/] " +
				"[see table 2] [/lib/B88FNQ7J/download/IJEFHXHF — 17 PAGE/]",
			{
				"feedback.pdf": "/lib/27BGDU89/download/IUA7YXN9",
				"essays.pdf": "/lib/B88FNQ7J/download/IJEFHXHF",
			},
		);

		expect(
			[...container.querySelectorAll("a")].map((link) =>
				link.getAttribute("href"),
			),
		).toEqual([
			"/lib/27BGDU89/download/IUA7YXN9#page=1",
			"/lib/27BGDU89/download/IUA7YXN9#page=6",
			"/lib/27BGDU89/download/IUA7YXN9#page=7",
			"/lib/B88FNQ7J/download/IJEFHXHF#page=17",
		]);
		expect(container.textContent).toContain("[see table 2]");
		expect(container.textContent).not.toContain("PAGE/");
	});

	it("opens the cited page when the model puts a label before the PAGE marker", async () => {
		// From a Girls' Education in Africa answer on Haiku 5.5. Nearby brackets and links must stay as they are.
		await render(
			"Not yet peer-reviewed. [Girl Power — PAGE /lib/DGL9WHAA/download/9RMDJSN3 — 22 PAGE/] " +
				"[Girl Power — PAGE /lib/DGL9WHAA/download/9RMDJSN3 — 1 PAGE/] " +
				"[Baird et al. 2013, PAGE /lib/DGL9WHAA/download/9RMDJSN3 — 5 PAGE/]. " +
				"[see table 2] [Girl Power](/lib/DGL9WHAA) [Girl Power — PAGE notes.pdf — 3 PAGE/]",
			{ "girl-power.pdf": "/lib/DGL9WHAA/download/9RMDJSN3" },
		);

		expect(
			[...container.querySelectorAll("a")].map((link) => link.getAttribute("href")),
		).toEqual([
			"/lib/DGL9WHAA/download/9RMDJSN3#page=22",
			"/lib/DGL9WHAA/download/9RMDJSN3#page=1",
			"/lib/DGL9WHAA/download/9RMDJSN3#page=5",
			"/lib/DGL9WHAA",
		]);
		expect(container.textContent).toContain("[see table 2]");
		expect(container.textContent).toContain("[Girl Power — PAGE notes.pdf — 3 PAGE/]");
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

	it("never links a library PDF the conversation did not read", async () => {
		// A model can copy the prompt's example target or name a publication it never read.
		await render(
			"Copied. [PAGE /lib/KEY/download/ATTACHMENT_KEY — 12 PAGE/] Guessed. [PAGE /lib/ZZZZ9999/download/WRONG001 — 4 PAGE/]",
		);

		expect(container.querySelector('a[href*="#page="]')).toBeNull();
		expect(
			container.querySelectorAll('[aria-label^="Citation source unavailable"]'),
		).toHaveLength(2);
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
	it("renders an archive excerpt as text without nested links or Markdown syntax", async () => {
		await act(async () => {
			root.render(
				<Link href="/digests/edition">
					<MarkdownExcerpt>{"Two **reports**: [country-filter test](/lib/ABCD1234) and [document test](/lib/EFGH5678)."}</MarkdownExcerpt>
				</Link>,
			);
		});
		expect(container.textContent).toBe("Two reports: country-filter test and document test.");
		expect(container.querySelectorAll("a")).toHaveLength(1);
		expect(container.querySelector("a")?.getAttribute("href")).toBe("/digests/edition");
	});
});
