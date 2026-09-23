// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-auth", () => ({ default: () => ({ auth: vi.fn(), handlers: {} }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: null }) }));
vi.mock("next-intl", () => ({
	useTranslations: () => (key: string) => key,
	useLocale: () => "en",
}));
vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
	useRouter: () => ({ push: vi.fn() }),
}));
// The explorer asks the listing for each row's publications; these tests read the page itself.
vi.mock("swr", () => ({ default: () => ({ data: undefined }) }));
vi.mock("@/components/features/items/Resource", () => ({ default: () => null }));

import HomePage, { type HomeContent, type HomeData, type Tone } from "@/components/pages/HomePage";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";

const config = projectPublicLibraryConfig(libraryConfigSchema.parse(minimalLibraryConfig));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const tone: Tone = { bg: "#fff", fg: "#000", fgRgb: "0 0 0", bgDark: "#000", fgDark: "#fff", fgRgbDark: "255 255 255" };
const tones = { page: tone, card: tone, tint: tone, accent: tone, tertiary: tone, deep: tone };

const about: HomeContent = {
	intro: "We gather **teacher research** from East Africa. See our [Website](https://).",
	curation: {
		text: "Every record is read by an editor before it goes live.",
		steps: [
			{ type: "arrival", title: "Submitted", text: "" },
			{ type: "check", title: "Read closely", text: "An editor checks the record." },
			{ type: "text", title: "Summarised", text: "We write a short summary." },
		],
	},
	team: "A small team of editors in Nairobi.",
	editors: [{ name: "Amina Yusuf", title: "Editor in chief", location: "Nairobi, Kenya" }],
	questions: ["How does coaching change teaching?"],
	involvement: { suggestions: true, editors: true },
	headings: { curation: "How we choose" },
};

const data: HomeData = {
	publications: 120,
	authors: 300,
	years: [{ year: 2020, count: 30 }, { year: 2022, count: 90 }],
	itemTypes: [{ itemType: "journalArticle", count: 100 }, { itemType: "report", count: 20 }],
	institutions: [{ name: "University of Nairobi", count: 40 }],
	countries: { KE: 80, UG: 20 },
	collections: [{ key: "COLL1", title: "Teachers", count: 60 }],
	topics: [{ name: "Teacher training", count: 60, key: "COLL1" }],
	languages: [{ name: "English", count: 80 }, { name: "French", count: 20 }],
	publishers: [{ name: "Open Press", count: 50 }],
	journals: [{ name: "Education Review", count: 30 }],
	recent: [],
	countryPaths: { KE: "Africa > Eastern Africa > KE" },
	covers: {},
	journey: { key: "ITEM1", title: "Coaching teachers in Kenya", submittedAt: "2026-05-01T00:00:00.000Z", reviewer: { name: "Omar Haddad", photo: null }, publishedAt: "2026-05-20T00:00:00.000Z", doi: "10.1234/coach" },
	cited: [],
	ai: true,
	digests: null,
	attachments: { total: 100, itemsWith: 90, withPdf: 60, percentage: 75 },
	citations: { total: 400, itemsWith: 30, average: 3.3, max: 40, percentage: 25, hIndex: 9 },
	collaboration: { rate: 0.2, collaborative: 24 },
	productivity: { multiple: 50, average: 1.4, max: 8 },
	updated: new Date("2026-09-01T00:00:00.000Z"),
};

describe("the library's home page", () => {
	let container: HTMLDivElement;
	let root: Root;

	beforeEach(() => {
		// jsdom has none of these; the entrance animations, the citation panel, the tab strip and the reduced-motion check use them.
		const observer = class { observe() {} unobserve() {} disconnect() {} };
		vi.stubGlobal("IntersectionObserver", observer);
		vi.stubGlobal("ResizeObserver", observer);
		vi.stubGlobal("CSS", { escape: (value: string) => value });
		vi.stubGlobal("scrollTo", () => undefined);
		vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }));
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		vi.unstubAllGlobals();
	});

	async function render(contact: { email: string | null; page: boolean }) {
		await act(async () => {
			root.render(
				<LibraryConfigProvider config={config}>
					<HomePage name="Teacher Evidence Library" siteUrl="https://library.example.org" contact={contact} today="2026-09-23" about={about} data={Promise.resolve(data)} tones={tones} ramp={[tone, tone]} shapes={[]} />
				</LibraryConfigProvider>,
			);
		});
		return container;
	}

	const headings = () => [...container.querySelectorAll("h2, h3")].map((heading) => heading.textContent);

	it("shows what the library wrote about itself and how it curates", async () => {
		await render({ email: "editors@example.org", page: false });

		expect(container.querySelector("h1")?.textContent).toBe("Teacher Evidence Library");
		expect(container.textContent).toContain("We gather teacher research from East Africa.");
		expect(headings()).toContain("How we choose");
		expect(headings()).not.toContain("curation");
		expect(headings()).toEqual(expect.arrayContaining(["Submitted", "Read closely", "Summarised"]));
		// The followed publication fills in the typed steps.
		expect(container.textContent).toContain("Arrived for review");
		expect(container.textContent).toContain("Checked by Omar Haddad");
		expect(container.textContent).toContain("Amina Yusuf");
		expect(container.textContent).toContain("Editor in chief");
		expect(container.textContent).toContain("How does coaching change teaching?");
	});

	it("shows a link it cannot follow as its words", async () => {
		await render({ email: null, page: true });

		expect(container.textContent).toContain("See our Website.");
		expect([...container.querySelectorAll("a")].some((link) => link.textContent === "Website")).toBe(false);
	});

	it("counts the publications without a top language as one row", async () => {
		await render({ email: null, page: true });

		const tab = [...container.querySelectorAll('[role="tab"]')].find((element) => element.textContent === "Languages");
		expect(tab).toBeDefined();
		await act(async () => (tab as HTMLElement).click());

		const rows = [...container.querySelectorAll('[role="tabpanel"] ol button')].map((row) => row.textContent);
		expect(rows).toEqual(["English67%80", "French17%20", "Other or none17%20"]);
	});

	it("offers the involvement buttons only where they lead somewhere", async () => {
		await render({ email: "editors@example.org", page: false });
		const links = () => [...container.querySelectorAll("a")].map((link) => link.getAttribute("href") ?? "");
		expect(links()).toContain(`mailto:editors@example.org?subject=${encodeURIComponent("suggestSubject")}`);
		expect(container.textContent).toContain("join");

		await render({ email: null, page: false });
		expect(links().some((href) => href.startsWith("mailto:") || href === "/contact")).toBe(false);
		expect(container.textContent).not.toContain("suggest");
		expect(container.textContent).not.toContain("join");
		// The people still have their band.
		expect(container.textContent).toContain("Amina Yusuf");
	});
});
