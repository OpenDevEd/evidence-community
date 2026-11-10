// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("next-intl", async () => {
	const english = await (await import("../helpers/next-intl-english")).englishIntl();
	const byKey = Object.assign((key: string) => key, { has: () => false });
	return {
		...(await vi.importActual<typeof import("next-intl")>("next-intl")),
		...english,
		// `home` holds whole sentences, so it reads in English; the rest come back by key.
		useTranslations: (namespace: string) => (namespace === "home" ? english.useTranslations(namespace) : byKey),
	};
});
vi.mock("@/i18n/routing", () => ({
	Link: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} {...props}>{children}</a>,
	useRouter: () => ({ push: vi.fn() }),
}));
// Who is reading, as the page's shell would have read it: where they stand with joining, and what its buttons opened.
const reader = vi.hoisted(() => ({ admin: false, join: "open" as "open" | "waiting" | "closed", opened: [] as string[] }));
vi.mock("@/components/layout/navbar/ReaderSession", () => ({
	SUGGEST_PARAM: "suggest",
	useOpenScholarUrl: () => (path: string) => path,
	useReaderSession: () => ({ reader: null, signInToSuggest: (text: string) => reader.opened.push(`sign in to suggest "${text}"`) }),
	useReaderLinks: () => ({ admin: reader.admin, join: reader.join, openJoin: () => reader.opened.push("join") }),
}));
// The explorer asks the listing for each row's publications; these tests read the page itself.
vi.mock("swr", () => ({ default: () => ({ data: undefined }) }));
vi.mock("@/components/features/items/Resource", () => ({ default: () => null }));

import HomePage, { type HomeContent, type HomeData, type Tone } from "@/components/pages/HomePage";
import { LibraryConfigProvider } from "@/context/LibraryConfigProvider";
import { projectPublicLibraryConfig } from "@/config/library-config/public";
import { libraryConfigSchema } from "@/config/library-config/schema";
import { minimalLibraryConfig } from "../fixtures/library-config";
import { homeRich } from "@/components/pages/HomeRichText";

const config = projectPublicLibraryConfig(libraryConfigSchema.parse(minimalLibraryConfig));
/** The same community with reader accounts on, which its Suggest papers button needs. */
const withAccounts = projectPublicLibraryConfig(libraryConfigSchema.parse({ ...minimalLibraryConfig, features: { readerAccounts: true } }));

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

// The page renders these on the server; the component receives them ready.
const rich = homeRich(about, "https://library.example.org");

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
	journey: { key: "ITEM1", title: "Coaching teachers in Kenya", reviewed: true, submittedAt: "2026-05-01T00:00:00.000Z", reviewer: { name: "Omar Haddad", photo: null }, publishedAt: "2026-05-20T00:00:00.000Z", doi: "10.1234/coach" },
	pipeline: null,
	cited: [],
	copies: [],
	examples: {},
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
		Object.defineProperty(document, "fonts", { configurable: true, value: new EventTarget() });
		container = document.createElement("div");
		document.body.append(container);
		root = createRoot(container);
	});

	afterEach(async () => {
		await act(async () => root.unmount());
		container.remove();
		Reflect.deleteProperty(document, "fonts");
		vi.unstubAllGlobals();
	});

	async function render(figures: HomeData = data, content: HomeContent = about, community = config) {
		await act(async () => {
			root.render(
				<LibraryConfigProvider config={community}>
					<HomePage name="Teacher Evidence Library" siteUrl="https://library.example.org" today="2026-09-23" about={content} rich={rich} data={Promise.resolve(figures)} tones={tones} ramp={[tone, tone]} shapes={[]} />
				</LibraryConfigProvider>,
			);
		});
		return container;
	}

	const headings = () => [...container.querySelectorAll("h2, h3")].map((heading) => heading.textContent);

	it("shows what the library wrote about itself and how it curates", async () => {
		await render();

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

	it("follows a publication that was only added, without a review date", async () => {
		const added = "2026-06-02T00:00:00.000Z";
		await render({ ...data, journey: { ...data.journey!, reviewed: false, reviewer: null, submittedAt: added, publishedAt: added } });

		expect(container.textContent).toContain("Added to the community");
		expect(container.textContent).not.toContain("Arrived for review");
		// Only its arrival is dated: nobody checked it on a known day.
		expect([...container.querySelectorAll("ol time")].map((time) => time.getAttribute("dateTime"))).toEqual([added]);
	});

	it("fills the library's own steps in from its searches and records, showing a zero as a zero", async () => {
		const steps = [
			...(["search", "sync", "duplicates", "fulltext"] as const).map((type) => ({ type, title: type, text: "" })),
			{ type: "text" as const, title: "screened", text: "", figure: { value: "25,000", label: "AI screening judgements" } },
		];
		await render({ ...data, pipeline: { terms: 159, topics: 29, added: 1240, merged: 0 } }, { ...about, curation: { steps } });

		const bodies = steps.map(({ title }) => [...container.querySelectorAll("li")].find((step) => step.querySelector("h3")?.textContent === title)?.textContent);
		// The page test translates to message keys: the topics join the terms' label.
		expect(bodies[0]).toMatch(/159.*figureTerms.*figureAndTopics/);
		expect(bodies[1]).toContain("1,240");
		expect(bodies[2]).toMatch(/^duplicates0/);
		expect(bodies[3]).toContain("60");
		expect(bodies[4]).toContain("25,000");
		// Counted steps carry no date, so the track has no date row.
		expect(container.querySelectorAll("ol time")).toHaveLength(0);
	});

	it("shows a link it cannot follow as its words", async () => {
		await render();

		expect(container.textContent).toContain("See our Website.");
		expect([...container.querySelectorAll("a")].some((link) => link.textContent === "Website")).toBe(false);
	});

	it("counts the publications without a top language as one row", async () => {
		await render();

		const tab = [...container.querySelectorAll('[role="tab"]')].find((element) => element.textContent === "Languages");
		expect(tab).toBeDefined();
		await act(async () => (tab as HTMLElement).click());

		const rows = [...container.querySelectorAll('[role="tabpanel"] ol button')].map((row) => row.textContent);
		expect(rows).toEqual(["English67%80", "French17%20", "Other or none17%20"]);
	});

	it("offers the involvement buttons only where they lead somewhere", async () => {
		const ways = () => [...container.querySelectorAll("button, a")].map((way) => way.textContent ?? "").filter((text) => /^(suggest|join)/.test(text));
		// Suggesting papers needs reader accounts to sign in with; joining is open to anyone.
		await render();
		expect(ways()).toEqual(["joinjoinHint"]);
		await render(data, about, withAccounts);
		expect(ways()).toEqual(["suggestsuggestHint", "joinjoinHint"]);
		// Signed out, Suggest papers signs the reader in first and comes back with its dialog open; Join opens applying.
		for (const way of container.querySelectorAll("button")) if (/^(suggest|join)/.test(way.textContent ?? "")) await act(async () => way.click());
		expect(reader.opened).toEqual(['sign in to suggest ""', "join"]);
		// An application sent says so; the team's own open the admin; a community taking none offers no way to join.
		reader.join = "waiting";
		await render(data, about, withAccounts);
		expect(ways()).toEqual(["suggestsuggestHint", "joinWaitingjoinWaitingHint"]);
		reader.admin = true;
		await render(data, about, withAccounts);
		expect(ways()).toEqual(["suggestsuggestHint", "joinAdminjoinAdminHint"]);
		expect(container.querySelector('a[href="/admin"]')?.textContent).toContain("joinAdmin");
		Object.assign(reader, { admin: false, join: "closed" });
		await render(data, about, withAccounts);
		expect(ways()).toEqual(["suggestsuggestHint"]);
		await render();
		expect(ways()).toEqual([]);
		// The people still have their band.
		expect(container.textContent).toContain("Amina Yusuf");
	});
});
