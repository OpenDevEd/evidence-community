"use client";

import { createContext, Suspense, use, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { animate, MotionConfig, motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useHydrated } from "@/hooks/useHydrated";
import { getRuntimeLinkHref } from "@/config/library-config/links";
import { useFormatter, useLocale, useTranslations } from "next-intl";
import useSWR, { preload, useSWRConfig } from "swr";
import { fetcher } from "@/lib/utils";
import { useLastFetchedData } from "@/context/Providers";
import type { ItemsGetResponse } from "@/app/api/items/types";
import { exampleQuestions } from "./home-content";
import { Link, useRouter } from "@/i18n/routing";
import { Input } from "@/components/nextui/Input";
import { AskAIButton } from "@/components/features/ai/AskAIButton";
import { handOverQuestion } from "@/components/features/ai/handed-over-question";
import { useInlineChatLayout } from "@/context/InlineChatLayout";
import PageContainer from "@/components/layout/PageContainer";
import { Button } from "@/components/nextui/Button";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { TextLink } from "@/components/digests/DigestPrimitives";
import { DigestCover } from "@/components/digests/DigestCover";
import type { DigestSummary } from "@/lib/notifications/public";
import { PdfCover, preloadItemCovers } from "@/components/features/items/PdfCover";
import { AuthorAvatar } from "@/components/authors/AuthorAvatar";
import type { CitationItem } from "@/lib/citation-formats";
import { useLibraryConfig, useLibraryFeature } from "@/context/LibraryConfigProvider";
import { useReaderLinks } from "@/components/layout/navbar/ReaderSession";
import { useSuggest } from "@/components/features/suggest/SuggestPapers";
import { hasOwnLogo, LibraryLogo } from "@/components/library/LibraryIdentity";
import type { ListItem } from "@/app/api/item/types";
import type { LibraryHomeConfig } from "@/config/library-config/schema";
import HomeMap, { type MapShape } from "./HomeMap";
import { examplesKey, listedRows, type Row } from "./home-explorer";
import { intlLocale } from "@/i18n/intl-locale";
import { Analytics01Icon, ArrowRight01Icon, ArrowUpRight01Icon, Book02Icon, CheckmarkCircle02Icon, DashboardSquare01Icon, InboxIcon, UserAdd01Icon, Building03Icon, Calendar03Icon, Folder01Icon, Globe02Icon, LanguageSkillIcon, BubbleChatQuestionIcon, Layers01Icon, Location01Icon, SentIcon, Notification03Icon, Pdf01Icon, QuoteUpIcon, Search01Icon, Tag01Icon, UniversityIcon, UserMultipleIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";
import { TruncatedText } from "@/components/nextui/TruncatedText";
import { RuntimeAsset } from "@/components/library/RuntimeAsset";
import { tonesFrom } from "./home-tones";

// Below the fold and heavy: the citation formatter with its styles. It loads when the reader nears it (see WhenNear),
// not with the page.
const loadCitationPanel = () => import("@/components/features/items/CitationControl");
// The panel formats the library's citation as it mounts, with the formatter it loads on first use: both come early.
const preloadCitations = () => Promise.all([loadCitationPanel(), import("@/lib/citation-formatter")]);
const CitationPanel = dynamic(() => loadCitationPanel().then((module) => module.CitationPanel), { ssr: false });
// The listing's result card, in its own file: the explorer's first cards are in the server's page, and the browser
// loads the card's code alongside it.
const Resource = dynamic(() => import("@/components/features/items/Resource"));

type ItemLinkProps = { onClick?: () => void; onPointerEnter?: () => void; onFocus?: () => void; onTouchStart?: () => void };

/**
 * Props for a link to a publication. Pointing at it loads the page's covers; clicking it hands the list copy to
 * the item page, which shows it at once while the full record loads, as it does coming from a result list. Only list
 * copies are handed over: a partial record would fill in after the page opens.
 */
const HandOff = createContext<(item: ListItem | undefined) => ItemLinkProps>(() => ({}));

/** Kept apart from the page, so remembering a copy re-renders only this and not everything inside it. */
function HandOffProvider({ children }: { children: React.ReactNode }) {
	const { setLastFetchedData } = useLastFetchedData();
	const handOff = useCallback((item: ListItem | undefined): ItemLinkProps => {
		if (!item) return {};
		const start = () => preloadItemCovers(item);
		return { onClick: () => setLastFetchedData({ items: [item] } as ItemsGetResponse), onPointerEnter: start, onFocus: start, onTouchStart: start };
	}, [setLastFetchedData]);
	return <HandOff value={handOff}>{children}</HandOff>;
}

/**
 * Loads a deferred part's code once the browser is idle after the page, so reaching it later mounts at once: the
 * citation styles take tens of milliseconds to evaluate, which would otherwise land in the middle of a scroll.
 */
function useIdlePreload(load: () => Promise<unknown>) {
	useEffect(() => {
		const start = () => void load().catch(() => {});
		if (typeof window.requestIdleCallback === "function") {
			const handle = window.requestIdleCallback(start, { timeout: 4000 });
			return () => window.cancelIdleCallback(handle);
		}
		const timer = window.setTimeout(start, 1500);
		return () => window.clearTimeout(timer);
	}, [load]);
}

// The library's home page: a map-backed hero, arched bands, and one explorer
// for every statistic the library exposes.


export type HomeData = {
	publications: number;
	authors: number;
	years: { year: number; count: number }[];
	itemTypes: { itemType: string; count: number }[];
	institutions: { name: string; count: number }[];
	countries: Record<string, number>;
	collections: { key: string; title: string; count: number }[];
	/** The top-level topics, each the collection it is, so same-named collections stay apart. */
	topics: { name: string; count: number; key: string }[];
	languages: { name: string; count: number }[];
	publishers: { name: string; count: number }[];
	journals: { name: string; count: number }[];
	/** The newest publications with a PDF, as a result list holds them. */
	recent: ListItem[];
	/** Each country's place in the listing's region filter ("Africa > Eastern Africa > KE"), by country code. */
	countryPaths: Record<string, string>;
	/** First pages of the recent publications that have a PDF, by publication key. */
	covers: Record<string, string>;
	/** The publication the curation steps follow, from submission to publication. */
	/** `reviewed` is false for a publication that was only added: it came in and went public at once. */
	journey: { key: string; title: string; reviewed: boolean; submittedAt: string; reviewer: { name: string; photo: string | null } | null; publishedAt: string; doi: string | null } | null;
	/**
	 * How the library's OpenAlex searches build it, for the steps that count it: the words, phrases and topics they
	 * search for, the records added in the last 30 days and the repeats merged away. Null
	 * when no step needs it or the library has no OpenAlex search.
	 */
	pipeline: { terms: number; topics: number; added: number; merged: number } | null;
	/** The most cited publications, for the citations preview. */
	cited: { key: string; title: string; citations: number }[];
	/** The most cited and followed publications as a result list holds them, for their item pages to open with. */
	copies: ListItem[];
	/** Each explorer view's first row of publications, under the address the explorer asks for them at. */
	examples: Record<string, ItemsGetResponse>;
	/** Whether the library's assistant answers questions across the library (`features.aiSearch`). */
	ai: boolean;
	/** The latest published digests, newest first. */
	digests: { library: string; editions: DigestSummary[] } | null;
	/** `withPdf`: publications with a PDF among their attachments. */
	attachments: { total: number; itemsWith: number; withPdf: number; percentage: number } | null;
	citations: { total: number; itemsWith: number; average: number; max: number; percentage: number; hIndex: number } | null;
	collaboration: { rate: number; collaborative: number } | null;
	productivity: { multiple: number; average: number; max: number } | null;
	updated: Date;
};

/** One band colour in both modes with a readable text colour for each. */
export type Tone = { bg: string; fg: string; fgRgb: string; bgDark: string; fgDark: string; fgRgbDark: string };
export type Tones = Record<"page" | "card" | "tint" | "accent" | "tertiary" | "deep", Tone>;

function humanType(itemType: string) {
	return itemType.replace(/([a-z])([A-Z])/g, "$1 $2");
}
/** "Report" to "reports", "Thesis" to "theses", "Case study" to "case studies". */
function plural(name: string) {
	const lower = name.toLowerCase();
	if (lower.endsWith("is")) return `${lower.slice(0, -2)}es`;
	if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
	return lower.endsWith("s") ? lower : `${lower}s`;
}

/* ---------- prose ---------- */

/**
 * What the library says about itself: the answers in OpenScholar's Home card. Each answer has one place on the page
 * and a blank one leaves its section out. `text` fields come from a small editor that knows bold, italic, links and
 * bulleted lists, stored as that subset of Markdown; everything else is plain text. `headings` renames a section; a
 * blank one keeps the translated default.
 */
export type StepType = LibraryHomeConfig["curation"]["steps"][number]["type"];

export type HomeContent = {
	/** One short paragraph under the library's tagline (Identity) in the hero. */
	intro?: string;
	/**
	 * The steps a publication takes into the library. A step's type decides what the timeline fills in: from the
	 * publication it follows, the date it arrived, the editor who checked it, its DOI; from the library, its search
	 * terms, its last update, the repeats it merged and its records with full text. A text step is its words only.
	 * `editor` is a chosen person from the team, shown on an editor check instead of whoever approved it.
	 */
	curation?: { text?: string; steps?: { title: string; text: string; type?: StepType; editor?: { name: string; photo?: string }; figure?: { value: string; label: string }; icon?: string }[] };
	team?: string;
	/** The people who run the library, shown in the team band. `photo` is an image address. */
	editors?: { name: string; title?: string; location?: string; photo?: string }[];
	/** Up to three example questions for the Ask box; an empty slot keeps the one made from the library's topics. */
	questions?: string[];
	involvement?: { suggestions: boolean; editors: boolean };
	extra?: { title?: string; text: string };
	headings?: Partial<Record<"curation" | "team" | "involvement", string>>;
};

/** The answers written in the bold-and-links editor, already rendered on the server (see HomeRichText). */
export type HomeRich = Partial<Record<"intro" | "curation" | "team" | "extra", React.ReactNode>>;

/**
 * Whether the reader asked for less motion, once the page is hydrated. The server cannot know, so the first render
 * assumes motion on both sides and the setting applies from the next one; `motion-reduce:` styles cover the frame
 * in between.
 */
function useLessMotion() {
	const hydrated = useHydrated();
	const reduce = useReducedMotion();
	return hydrated && Boolean(reduce);
}

/** A band's lead sentence, set large under its header; the same size wherever it appears. */
const leadStatement = "max-w-[30ch] text-3xl leading-[1.12] text-[rgb(var(--ink-rgb)/0.7)] lg:text-5xl lg:leading-[1.08]";
/** A long lead sentence steps down a size, so it stays a statement rather than a wall. */
const leadFor = (text: string) => (text.length > 180 ? "max-w-[40ch] text-2xl leading-[1.2] text-[rgb(var(--ink-rgb)/0.7)] lg:text-[2rem] lg:leading-[1.18]" : leadStatement);


/** The parts every library has, shown under "Inside the library" with a live look at each. Not configurable. */
type Part = "publications" | "ai" | "citations" | "digests";

// Dates are formatted in UTC, so the server and every browser print the same day.
const SHORT_DATE = { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" } as const;
/** A conic light spun on the spot; the Ask console draws it behind its question box as a ring and as a glow. */
const turningLight = <span aria-hidden className="absolute left-1/2 top-1/2 -ml-[80%] -mt-[80%] aspect-square w-[160%] animate-spin bg-[conic-gradient(from_0deg,transparent_0deg,rgb(var(--color-accent-300))_50deg,rgb(var(--color-accent-500))_110deg,transparent_170deg,transparent_360deg)] [animation-duration:5s] motion-reduce:animate-none" />;

/** The example questions on the Ask console: a pill that brightens under the pointer; the text keeps the band's colour. */
/** A list entry in a preview: spacing only; the rules belong to the rows around it. */
const previewItem = "py-2.5 first:pt-0 last:pb-0";
const previewLink = "group flex gap-6 outline-offset-4";

/** Where each kind of item leads, and what the link says. */
const destinations = {
	publications: { href: "/lib", label: "browseTheLibrary" },
	ai: null,
	citations: null,
	digests: { href: "/digests", label: "allDigests" },
} as const satisfies Record<Part, { href: string; label: string } | null>;

const parts = [
	{ shows: "publications", title: "parts.publications.title", text: "parts.publications.text", has: (data: HomeData) => data.recent.length > 0 },
	{ shows: "ai", title: "parts.ai.title", text: "parts.ai.text", has: (data: HomeData) => data.ai },
	{ shows: "citations", title: "parts.citations.title", text: "parts.citations.text", has: (data: HomeData) => data.cited.length > 0 },
	{ shows: "digests", title: "parts.digests.title", text: "parts.digests.text", has: (data: HomeData) => Boolean(data.digests?.editions.length) },
] as const satisfies { shows: Part; title: string; text: string; has: (data: HomeData) => boolean }[];

/** The bold parts of a translated sentence. */
const strong = (chunks: React.ReactNode) => <strong className="font-semibold">{chunks}</strong>;
type HomeTranslator = ReturnType<typeof useTranslations<"home">>;

function Preview({ shows, data, surface, questions }: { shows: Part; data: HomeData; surface: Tone; questions?: string[] }) {
	switch (shows) {
		case "publications":
			return <LatestPublications data={data} />;
		case "ai":
			return <AskPreview data={data} surface={surface} questions={questions} />;
		case "citations":
			return <MostCited data={data} />;
		case "digests":
			return <LatestDigests digests={data.digests} />;
	}
}

function LatestPublications({ data }: { data: HomeData }) {
	const format = useFormatter();
	const handOff = use(HandOff);
	return (
		<ol className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
			{data.recent.slice(0, 6).map((item) => (
				<li key={item.key}>
					<Link href={`/lib/${item.key}`} {...handOff(item)} className="group block outline-offset-4">
						<span className="block shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1.5 motion-reduce:transition-none [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
							<PdfCover src={data.covers[item.key]} alt="" sizes="(min-width: 1024px) 208px, (min-width: 640px) 33vw, 50vw" />
						</span>
						<span className="mt-3 line-clamp-3 text-sm font-medium leading-snug transition-colors group-hover:text-accent">{item.title || item.key}</span>
						{item.datePublished && <span className="mt-1 block text-xs tabular-nums opacity-60">{format.dateTime(new Date(item.datePublished), SHORT_DATE)}</span>}
					</Link>
				</li>
			))}
		</ol>
	);
}

function MostCited({ data }: { data: HomeData }) {
	const format = useFormatter();
	const handOff = use(HandOff);
	return (
		<ol className="grid gap-x-10 gap-y-8 sm:grid-cols-3">
			{data.cited.map((row) => (
				<li key={row.key}>
					<Link href={`/lib/${row.key}`} {...handOff(data.copies.find((copy) => copy.key === row.key))} className="group flex gap-5 outline-offset-4">
						{/* The cover keeps its own height: stretched to a long title beside it, its shadow would hang below the page. */}
						<span className="block w-24 shrink-0 self-start rounded-xl shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1 motion-reduce:transition-none [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
							<PdfCover src={data.covers[row.key]} alt="" width={96} title={row.title} />
						</span>
						<span className="min-w-0 pt-1">
							<span className="block font-heading text-4xl font-semibold leading-none tabular-nums">{format.number(row.citations)}</span>
							<span className="mt-1 block text-sm opacity-60">{row.citations === 1 ? "citation" : "citations"}</span>
							<span className="mt-3 line-clamp-3 text-base font-medium leading-snug transition-colors group-hover:text-accent">{row.title}</span>
						</span>
					</Link>
				</li>
			))}
		</ol>
	);
}

function LatestDigests({ digests }: { digests: HomeData["digests"] }) {
	const tLabels = useTranslations("home");
	const locale = useLocale();
	const [latest, ...earlier] = digests?.editions ?? [];
	if (!digests || !latest) return null;
	return (
		<div className="grid gap-12 lg:grid-cols-[28rem_minmax(0,1fr)] lg:gap-20">
			<div className="pr-4 pt-2">
				<DigestCover edition={latest} libraryName={digests.library} href={`/digests/${latest.slug}`} locale={locale} titleAs="h3" />
			</div>
			{earlier.length > 0 && (
				<div>
					<h3 className="text-sm font-semibold opacity-75">{tLabels("earlierIssues")}</h3>
					<ol className="mt-3">
						{earlier.map((edition) => (
							<li key={edition.slug} className="border-b border-[rgb(var(--ink-rgb)/0.1)] py-4 last:border-b-0">
								<Link href={`/digests/${edition.slug}`} className="group block outline-offset-4">
									<span className="block text-sm tabular-nums opacity-60">{edition.period.label}</span>
									<span className="mt-1 block font-heading text-lg font-medium leading-snug transition-colors group-hover:text-accent">{edition.title}</span>
								</Link>
							</li>
						))}
					</ol>
				</div>
			)}
		</div>
	);
}

/**
 * How to cite the library itself, through the same citation panel as every publication (styles, picker, copy). The
 * library is described as a web page read today, built from its name and address, so no library has to write it.
 */
function CiteSlip({ name, url, today }: { name: string; url: string; today: string }) {
	useIdlePreload(preloadCitations);
	const { citations } = useLibraryConfig();
	if (!citations.enabled) return null;
	const library: CitationItem = { key: "library", title: name, itemType: "Webpage", url, accessDate: today };
	// The block a publication page shows, so citing the library looks like citing anything else in it.
	return (
		<WhenNear placeholder={<div className="min-h-[9rem]" />}>
			<CitationPanel item={library} showHeading completeRecord link={url} />
		</WhenNear>
	);
}


/** Lines one tile apart across the floor, in the library's accent. */
const horizonTiles = {
	backgroundImage: "linear-gradient(rgb(var(--color-accent-400) / 0.45) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--color-accent-400) / 0.45) 1px, transparent 1px)",
	backgroundSize: "48px 48px",
};

/**
 * A grid floor running out to a lit horizon, moving toward the reader as if flown over, behind the question box. The
 * floor is tilted once and only a layer inside it moves, one tile at a time, so the motion stays on the compositor.
 * Still for reduced motion.
 */
function HorizonGrid() {
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
			<div className="absolute inset-x-0 top-[55%] h-px bg-[linear-gradient(to_right,transparent,rgb(var(--color-accent-300)/0.9),transparent)] shadow-[0_0_30px_6px_rgb(var(--color-accent-500)/0.5)]" />
			<div className="absolute -inset-x-1/2 bottom-[-40%] top-[55%] origin-top overflow-hidden [mask-image:linear-gradient(to_bottom,transparent,black_35%)] [transform:perspective(420px)_rotateX(62deg)]">
				<div className="absolute inset-x-0 -top-12 bottom-0 animate-horizon-grid motion-reduce:animate-none" style={horizonTiles} />
			</div>
			<div className="absolute left-1/2 top-[55%] h-3/5 w-3/5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(var(--color-accent-500)/0.28),transparent)] blur-2xl" />
		</div>
	);
}

/** A country's name in the page's language, from its two-letter code. */
function useCountryName() {
	const locale = useLocale();
	return useMemo(() => {
		const names = new Intl.DisplayNames([intlLocale(locale)], { type: "region" });
		return (code: string) => names.of(code) ?? code;
	}, [locale]);
}

/**
 * The assistant, ready to use: a question box that opens the library with the question asked, and three examples
 * built from the library's own topics and countries so they fit whatever it holds.
 */
function AskPreview({ data, surface, questions }: { data: HomeData; surface: Tone; questions?: string[] }) {
	const tLabels = useTranslations("home");
	const router = useRouter();
	const [question, setQuestion] = useState("");
	const countryName = useCountryName();
	const examples = exampleQuestions(data, countryName, questions, {
		about: (topic) => tLabels("exampleAbout", { topic }),
		studied: (country) => tLabels("exampleStudied", { country }),
		approaches: (topic) => tLabels("exampleApproaches", { topic }),
	}).filter((example): example is string => Boolean(example));
	const submit = () => {
		if (!question.trim()) return;
		handOverQuestion(question.trim());
		router.push("/lib");
	};
	return (
		// Night over the grid: the band's colour taken most of the way to black, so any library's accent glows on it, and
		// white text whatever the band's own text colour is.
		<div
			className="relative isolate overflow-hidden rounded-3xl bg-[color-mix(in_oklab,var(--band-bg)_28%,#02040b)] px-6 py-12 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.08),0_0_0_1px_rgb(var(--color-accent-400)/0.18),0_30px_80px_-40px_rgb(var(--color-accent-500)/0.6)] [--ink-rgb:255_255_255] dark:bg-[color-mix(in_oklab,var(--band-bg-dark)_28%,#02040b)] sm:px-10 lg:py-16"
			style={toneStyle(surface)}
		>
			<HorizonGrid />
			<div className="relative mx-auto max-w-3xl">
				{/* A turning light runs around the box: spun behind it, it shows as a thin ring, with a blurred copy as its glow. */}
				<div className="relative">
					<div aria-hidden className="absolute -inset-1.5 overflow-hidden rounded-[24px] opacity-80 blur-xl">{turningLight}</div>
					<div className="relative overflow-hidden rounded-[18px] p-[3px]">
						{turningLight}
						<Input
							aria-label={tLabels("askTheLibraryAQuestion")}
							value={question}
							onValueChange={setQuestion}
							onKeyDown={(event) => {
								if (event.key === "Enter" && !event.nativeEvent.isComposing) submit();
							}}
							placeholder={tLabels("askAnythingAboutTheResearchHere")}
							size="lg"
							// Solid on hover: the shared field's hover tint would let the turning light show through it. Its own text
							// colour: it sits on the dark panel, whose white text it would otherwise take on.
							classNames={{ base: "relative", inputWrapper: "h-14 min-h-14 rounded-2xl pr-2 shadow-none !bg-white dark:!bg-secondary", input: "text-black dark:text-white" }}
							endContent={<AskAIButton hint="↵" onAsk={submit} />}
						/>
					</div>
				</div>
				{examples.length > 0 && (
					// Each example is drawn as the chat will show it once asked: the reader's own message, right-aligned beside
					// its mark, so a click reads as sending it.
					<ul className="mt-5 flex flex-col items-end gap-2.5">
						{examples.map((example) => (
							<li key={example} className="flex max-w-full items-start gap-2">
								<Link href="/lib" data-asks-library onClick={() => handOverQuestion(example)} className="group flex items-start gap-2.5 rounded-xl bg-white px-4 py-2.5 text-[15px] font-medium leading-snug text-black outline-offset-2 transition-transform duration-200 hover:-translate-y-px motion-reduce:transition-none dark:bg-secondary dark:text-white">
									<span>{example}</span>
									<HugeiconsIcon icon={SentIcon} aria-hidden size={16} className="mt-0.5 shrink-0 text-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
								</Link>
								<span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-full bg-accent text-white">
									<HugeiconsIcon icon={BubbleChatQuestionIcon} size={16} />
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}

/** One row per part the library has: what it is on the left, a live look at it on the right, drawn from the library itself. */
function Inside({ data, surface, questions }: { data: HomeData; surface: Tone; questions?: string[] }) {
	const tLabels = useTranslations("home");
	const locale = useLocale();
	const shown = parts.filter((part) => part.has(data));
	if (!shown.length) return <p className="text-lg opacity-70">{tLabels("theLibrarySPublicationsWillAppear")}</p>;
	return (
		<ul>
			{shown.map((part) => {
				const destination = destinations[part.shows];
				return (
					<motion.li key={part.shows} {...reveal} className="border-t border-[rgb(var(--ink-rgb)/0.1)] py-12 first:border-t-0 first:pt-0 lg:py-14 lg:first:pt-0">
						<div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
							<div>
								<h2 className="text-[1.75rem] font-bold leading-tight tracking-tight lg:text-3xl">{tLabels(part.title)}</h2>
								<p className="mt-2 max-w-[40rem] text-base leading-7 opacity-75">{tLabels(part.text)}</p>
							</div>
							{destination && <TextLink href={destination.href}>{tLabels(destination.label)}</TextLink>}
						</div>
						<Preview shows={part.shows} data={data} surface={surface} questions={questions} />
					</motion.li>
				);
			})}
		</ul>
	);
}

/** On the accent band: the editors' statement set large, then the path an entry takes, side by side under big numerals. */
function Curation({ curation, statement, heading, data }: { curation: NonNullable<HomeContent["curation"]>; statement: React.ReactNode; heading: string; data: Promise<HomeData> }) {
	const steps = curation.steps?.length ? curation.steps : null;
	if (!curation.text && !steps) return null;
	return (
		<>
			<Heading>{heading}</Heading>
			{curation.text && <Reading className={leadFor(curation.text)}>{statement}</Reading>}
			{steps && (
				<div className={curation.text ? "mt-16 lg:mt-20" : ""}>
					<Suspense fallback={<Timeline steps={steps} data={null} />}>
						<WithData data={data}>{(figures) => <Timeline steps={steps} data={figures} cover={figures.journey ? figures.covers[figures.journey.key] : undefined} copy={figures.copies.find((copy) => copy.key === figures.journey?.key)} />}</WithData>
					</Suspense>
				</div>
			)}
		</>
	);
}

type Step = NonNullable<NonNullable<HomeContent["curation"]>["steps"]>[number];

const LONG_DAY = { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" } as const;

/** Timeline columns on wide screens, one per step; below that the steps run down one vertical track. */
const TIMELINE_COLUMNS: Record<number, string> = { 1: "", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" };

/** A count set large under a step's name, with what it counts. */
type FigureKey = "figureTerms" | "figureTopics" | "figureAdded" | "figureMerged" | "figureFullText";
/** A counted figure's label is a translated message for its count; a text step's is its owner's words. */
type StepFigureValue = { value: string; label: string | { key: FigureKey; count: number; topics?: number } };

type Happening = { when?: string; body?: React.ReactNode; figure?: StepFigureValue };

/**
 * What a step's type shows: from the publication the timeline follows (or the editor chosen for it), or from what the
 * library counts of its searches and records. A count shows once it arrives, zero included, so the space kept for it
 * while the figures load is always filled.
 */
function happened(step: Step, data: Figures | null, format: Formatter): Happening {
	return step.type ? HAPPENINGS[step.type](step, data, format) : {};
}

type Figures = Pick<HomeData, "journey" | "pipeline" | "attachments">;

type Formatter = ReturnType<typeof useFormatter>;

const HAPPENINGS: Record<StepType, (step: Step, data: Figures | null, format: Formatter) => Happening> = {
	check: (step, data) => checked(step, data?.journey ?? null),
	arrival: (_, data) => (data?.journey ? { when: data.journey.submittedAt, body: <Arrived reviewed={data.journey.reviewed} /> } : {}),
	publication: (_, data) => (data?.journey ? { when: data.journey.publishedAt, body: <Published doi={data.journey.doi} /> } : {}),
	search: (_, data, format) => ({ figure: searched(data?.pipeline, format) }),
	sync: (_, data, format) => ({ figure: figureOf(data?.pipeline?.added, "figureAdded", format) }),
	duplicates: (_, data, format) => ({ figure: figureOf(data?.pipeline?.merged, "figureMerged", format) }),
	fulltext: (_, data, format) => ({ figure: figureOf(data?.attachments?.withPdf, "figureFullText", format) }),
	text: (step) => ({ figure: step.figure }),
};

function searched(pipeline: HomeData["pipeline"] | undefined, format: Formatter) {
	if (pipeline?.topics && !pipeline.terms) return figureOf(pipeline.topics, "figureTopics", format);
	return figureOf(pipeline?.terms, "figureTerms", format, pipeline?.topics || undefined);
}

/** Stands in for the library's figures while they load, so a counted step keeps the size its line will take. */
const LOADING_FIGURES: Figures = {
	journey: null,
	pipeline: { terms: 100, topics: 10, added: 1_000, merged: 1_000 },
	attachments: { total: 0, itemsWith: 0, withPdf: 10_000, percentage: 0 },
};

const COUNTED_TYPES = new Set<StepType>(["search", "sync", "duplicates", "fulltext"]);

function figureOf(count: number | undefined, key: FigureKey, format: Formatter, topics?: number): StepFigureValue | undefined {
	return count === undefined ? undefined : { value: format.number(count), label: { key, count, topics } };
}

function Arrived({ reviewed }: { reviewed: boolean }) {
	const tLabels = useTranslations("home");
	return <>{reviewed ? tLabels("arrivedForReview") : tLabels("addedToTheLibrary")}</>;
}

function CheckedBy({ name }: { name: string }) {
	const tLabels = useTranslations("home");
	return <span>{tLabels.rich("checkedBy", { name, strong })}</span>;
}

function Published({ doi }: { doi?: string | null }) {
	const tLabels = useTranslations("home");
	if (!doi) return <>{tLabels("published")}</>;
	return <>{tLabels.rich("publishedWithDoi", { doi, link: (chunks) => <a href={`https://doi.org/${doi}`} className="font-semibold underline decoration-1 underline-offset-4">{chunks}</a> })}</>;
}

/** Without a review nobody checked the publication on a known day: the step keeps the editor chosen for it, undated. */
function checked(step: Step, journey: HomeData["journey"]): Happening {
	const editor = step.editor ?? journey?.reviewer;
	const body = editor ? (
		<span className="flex items-center gap-3">
			<AuthorAvatar src={editor.photo ?? undefined} alt="" size="md" className="shrink-0" />
			<CheckedBy name={editor.name} />
		</span>
	) : undefined;
	return { when: journey?.reviewed ? journey.publishedAt : undefined, body };
}

/**
 * The steps on one track, each a node with its date above and its name, what happened and its words below. Following
 * a reviewed publication, its first page stands at the start of the track; without one the track carries the steps.
 */
function Timeline({ steps, data, cover, copy }: { steps: Step[]; data: HomeData | null; cover?: string; copy?: ListItem }) {
	const format = useFormatter();
	const journey = data?.journey ?? null;
	// Until the figures arrive a followed publication is likely, so its cover keeps its place.
	const covered = journey !== null || !data;
	// Beside a cover the line always crosses it below its top edge, at the height a row of dates puts it, whether or
	// not any step has a date.
	const dated = covered || steps.some((step) => happened(step, data, format).when);
	const shape = steps.some((step) => step.icon) ? ICON_NODES : PLAIN_NODES;
	const track = `absolute inset-x-0 hidden h-0.5 rounded-full lg:block ${covered ? "lg:-left-40" : ""} [mask-image:linear-gradient(to_right,black_78%,transparent)] ${dated ? shape.datedTrack : shape.track}`;
	const timeline = (
		<ol className={`relative grid gap-x-10 gap-y-10 lg:gap-y-0 ${TIMELINE_COLUMNS[Math.min(steps.length, 5)]}`}>
			<span aria-hidden className={`${track} bg-[rgb(var(--ink-rgb)/0.18)]`} />
			<motion.span aria-hidden initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={seen} transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.2 }} className={`${track} origin-left bg-[rgb(var(--color-accent-700))]`} />
			{steps.map((step, index) => <TimelineStep key={`${step.title}-${index}`} step={step} data={data} dated={dated} shape={shape} index={index} last={index === steps.length - 1} />)}
		</ol>
	);
	if (!covered) return timeline;
	return (
		<div className="grid gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-16">
			<TimelineCover journey={journey} cover={cover} copy={copy} />
			{timeline}
		</div>
	);
}

/** The followed publication's cover beside the track, or its place while the figures load. */
function TimelineCover({ journey, cover, copy }: { journey: HomeData["journey"]; cover?: string; copy?: ListItem }) {
	const handOff = use(HandOff);
	// The publication as a printed thing: turned towards its journey, pages showing at the edge, a light passing over it
	// as it comes into view; it turns to face the reader under the pointer.
	return journey ? (
		<Link href={`/lib/${journey.key}`} {...handOff(copy)} aria-label={journey.title} className={`group relative z-10 block max-w-[12rem] outline-offset-4 [perspective:1100px] self-start`}>
			<span className="relative block rounded-xl shadow-[3px_3px_0_-1px_#f6f3ec,4px_4px_0_-1px_rgb(0_0_0/0.2),7px_7px_0_-2px_#ebe6da,8px_8px_0_-2px_rgb(0_0_0/0.2),28px_32px_44px_-14px_rgb(0_0_0/0.6)] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] [transform:rotateY(20deg)_rotateX(4deg)] group-hover:[transform:rotateY(0deg)_rotateX(0deg)] motion-reduce:transition-none motion-reduce:[transform:none] [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
				<PdfCover src={cover} alt="" width={192} />
				{/* The cover triggers the sweep: the light starts clipped outside it, where it could never be seen to be in view. */}
				<motion.span aria-hidden initial="rest" whileInView="swept" viewport={seen} className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
					<motion.span variants={{ rest: { x: "-110%" }, swept: { x: "110%", transition: { duration: 2.4, delay: 0.8, ease: [0.45, 0, 0.25, 1] } } }} className="absolute -inset-y-1/4 left-0 w-[150%] -skew-x-[22deg] bg-[linear-gradient(100deg,transparent_22%,rgb(255_255_255/0.06)_38%,rgb(255_255_255/0.2)_50%,rgb(255_255_255/0.06)_62%,transparent_78%)] mix-blend-screen" />
				</motion.span>
			</span>
		</Link>
	) : (
		// The cover's place while the figures load, so the steps do not narrow when it arrives.
		<span aria-hidden className="block aspect-[3/4] w-full max-w-[12rem] self-start" />
	);
}

/**
 * One step on the track: its date, its node, its name, what happened or its figure, and its words. On wide screens
 * each of these is a row shared by every step, so names, figures and words line up across the columns.
 */
function TimelineStep({ step, data, dated, shape, index, last }: { step: Step; data: HomeData | null; dated: boolean; shape: NodeShape; index: number; last: boolean }) {
	const format = useFormatter();
	const { when, body, figure, loading } = shown(step, data, format);
	return (
		<li className={`relative lg:pl-0 ${shape.indent}`}>
			{/* Below lg the track runs down the left: each step draws the stretch to the next, the last one fades out. */}
			<span aria-hidden className={`absolute w-0.5 ${shape.rail} bg-[rgb(var(--color-accent-700))] lg:hidden ${last ? "h-16 [mask-image:linear-gradient(to_bottom,black,transparent)]" : "-bottom-10"}`} />
			{/* On wide screens the dates share one row above the track, so every node sits on the line. */}
			{dated ? <StepDate when={when} /> : null}
			<StepNode icon={step.icon} shape={shape} dated={dated} index={index} />
			<h3 className={`font-heading text-xl font-semibold tracking-tight ${shape.title} ${dated && when ? "mt-1" : ""}`}>{step.title}</h3>
			<StepValue value={figure?.value} hidden={loading} />
			<StepOutcome label={figure?.label} body={figure ? undefined : body} hidden={loading} />
			<StepWords text={step.text} />
		</li>
	);
}

/**
 * Where the track and a step's parts sit around its node. With an icon on any step every node is a ring the icon's
 * size, so the line runs through their centres; otherwise the nodes are small rings.
 */
type NodeShape = { node: string; track: string; datedTrack: string; indent: string; rail: string; title: string };
const PLAIN_NODES: NodeShape = { node: "top-1 size-4", track: "top-[7px]", datedTrack: "top-[43px]", indent: "pl-10", rail: "left-[7px] top-4", title: "lg:mt-7" };
const ICON_NODES: NodeShape = { node: "top-0 size-11", track: "top-[21px]", datedTrack: "top-[57px]", indent: "pl-16", rail: "left-[21px] top-11", title: "pt-2 lg:mt-5 lg:pt-0" };

const RING = "border-2 border-[rgb(var(--color-accent-700))] bg-[var(--band-bg)] shadow-[0_0_0_4px_var(--band-bg),0_0_14px_rgb(var(--color-accent-700)/0.6)] dark:bg-[var(--band-bg-dark)] dark:shadow-[0_0_0_4px_var(--band-bg-dark),0_0_14px_rgb(var(--color-accent-700)/0.6)]";
/** An icon node: the icon cut out of a solid disc in the accent. */
const DISC = "bg-[rgb(var(--color-accent-700))] text-[var(--band-bg)] shadow-[0_0_0_4px_var(--band-bg),0_0_14px_rgb(var(--color-accent-700)/0.6)] dark:text-[var(--band-bg-dark)] dark:shadow-[0_0_0_4px_var(--band-bg-dark),0_0_14px_rgb(var(--color-accent-700)/0.6)]";

/** A step's node on the track. Icons pop in one after another as the line draws through them. */
function StepNode({ icon, shape, dated, index }: { icon?: string; shape: NodeShape; dated: boolean; index: number }) {
	const place = `absolute left-0 grid place-items-center rounded-full lg:relative lg:left-auto lg:top-auto ${shape.node} ${dated ? "lg:mt-3" : ""}`;
	if (shape === PLAIN_NODES) return <span aria-hidden className={`${place} ${RING}`} />;
	return (
		<motion.span aria-hidden initial={{ scale: 0.4, opacity: 0 }} whileInView={{ scale: 1, opacity: 1 }} viewport={seen} transition={{ type: "spring", stiffness: 320, damping: 18, delay: 0.3 + index * 0.16 }} className={`${place} ${DISC}`}>
			{icon ? <RuntimeAsset reference={icon} alt="" width={22} height={22} /> : null}
		</motion.span>
	);
}

function StepWords({ text }: { text?: string }) {
	return text ? <p className="mt-2 text-sm leading-6 opacity-75">{text}</p> : null;
}

/** A step's figure, set large. */
function StepValue({ value, hidden }: { value?: string; hidden: boolean }) {
	if (!value) return null;
	return <p aria-hidden={hidden || undefined} className={`mt-4 font-heading text-3xl font-semibold leading-none tracking-tight tabular-nums xl:text-4xl ${hidden ? "invisible" : ""}`}>{value}</p>;
}

/** What a step's figure counts, or what happened to the followed publication. */
function StepOutcome({ label, body, hidden }: { label?: StepFigureValue["label"]; body?: React.ReactNode; hidden: boolean }) {
	const t = useTranslations("homePage");
	if (!label && !body) return null;
	const words = typeof label === "object" ? `${t(label.key, { count: label.count })}${label.topics ? ` ${t("figureAndTopics", { topics: label.topics })}` : ""}` : label;
	return (
		<div aria-hidden={hidden || undefined} className={`text-base ${label ? "mt-1.5 leading-6" : "mt-3 leading-7"} ${hidden ? "invisible" : ""}`}>
			{words ?? body}
		</div>
	);
}

/** What a step shows; while the figures load, a counted step lays out an invisible stand-in figure. */
function shown(step: Step, data: HomeData | null, format: Formatter) {
	const loading = !data && step.type !== undefined && COUNTED_TYPES.has(step.type);
	return { ...happened(step, loading ? LOADING_FIGURES : data, format), loading };
}

/** A step's date; an undated step keeps the row empty on wide screens so its node stays on the track. */
function StepDate({ when }: { when?: string }) {
	const format = useFormatter();
	return <p className={`font-heading text-base font-semibold leading-6 tabular-nums lg:h-6 ${when ? "" : "hidden lg:block"}`}>{when ? <time dateTime={when}>{format.dateTime(new Date(when), LONG_DAY)}</time> : null}</p>;
}

/**
 * Below xl the wall does not fit beside the text: one row of the newest first pages crosses the top of the hero on a
 * rising diagonal instead, drifting along its own line and running up under the navigation bar. It sits in the hero's
 * background, under the wash that keeps the text readable, so it fades out as it reaches the text.
 */
function HeroRow({ data }: { data: HomeData }) {
	// One row shows each first page once per turn already; six keep the phone's download small.
	const covered = data.recent.filter((publication) => data.covers[publication.key]).slice(0, 6);
	if (covered.length < 4) return null;
	const row = [...covered, ...covered];
	return (
		<div aria-hidden className="absolute inset-x-0 top-0 h-80 overflow-hidden sm:h-96 xl:hidden">
			<div className="absolute left-1/2 top-[30%] w-[240%] sm:top-[42%] -translate-x-1/2 -translate-y-1/2 -rotate-[20deg] sm:-rotate-[12deg] [mask-image:linear-gradient(to_right,transparent,black_25%,black_75%,transparent)]">
				<div className="flex w-max animate-marquee motion-reduce:animate-none" style={{ animationDuration: `${covered.length * 7}s` }}>
					{row.map((publication, index) => (
						<span key={`${publication.key}-${index}`} className="block w-32 shrink-0 pr-4 sm:w-40">
							<span className="block overflow-hidden rounded-xl shadow-lg [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
								<PdfCover src={data.covers[publication.key]} alt="" width={144} />
							</span>
						</span>
					))}
				</div>
			</div>
		</div>
	);
}

/**
 * The newest publications' first pages drifting past in two columns, one up and one down, in the hero's empty half.
 * From xl up, where it fits beside the text; still for reduced motion; each cover opens its publication.
 */
function HeroShelf({ data }: { data: HomeData }) {
	const handOff = use(HandOff);
	const covered = data.recent.filter((publication) => data.covers[publication.key]);
	if (covered.length < 4) return null;
	// Each column takes its own run of first pages, so no two show the same one while the library has enough; a column
	// needs four to fill its height as it loops, and with fewer pages the runs start apart so they overlap least.
	const perColumn = Math.max(4, Math.ceil(covered.length / 3));
	const run = (index: number) => {
		const start = Math.floor((index * covered.length) / 3);
		return Array.from({ length: perColumn }, (_, offset) => covered[(start + offset) % covered.length]!);
	};
	const column = (publications: ListItem[], down: boolean) => (
		// Its own height, not the row's: the loop moves it by half of it, one copy of its pages.
		<div className={`flex w-44 shrink-0 flex-col self-start animate-marquee-up group-hover/shelf:[animation-play-state:paused] motion-reduce:animate-none ${down ? "[animation-direction:reverse]" : ""}`} style={{ animationDuration: `${publications.length * 12}s` }}>
			{[...publications, ...publications].map((publication, index) => {
				const copy = index >= publications.length;
				return (
					<Link key={`${publication.key}-${index}`} href={`/lib/${publication.key}`} {...handOff(publication)} aria-hidden={copy || undefined} tabIndex={copy ? -1 : undefined} aria-label={copy ? undefined : publication.title || publication.key} className={`block pb-5 outline-offset-4 ${copy ? "motion-reduce:hidden" : ""}`}>
						<span className="block overflow-hidden rounded-xl shadow-lg [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
							<PdfCover src={data.covers[publication.key]} alt="" width={176} />
						</span>
					</Link>
				);
			})}
		</div>
	);
	return (
				<div className="group/shelf absolute bottom-6 top-0 hidden w-[40rem] xl:-right-14 animate-hero-rise overflow-hidden [animation-delay:300ms] [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_74%,transparent),linear-gradient(to_right,transparent,black_30%)] motion-reduce:animate-none xl:block">
			<div className="flex h-full -rotate-[8deg] justify-end gap-5 pr-2">
				{column(run(0), false)}
				<div className="pt-28">{column(run(1), true)}</div>
				<div className="pt-10">{column(run(2), false)}</div>
			</div>
		</div>
	);
}

/**
 * The editors passing by in an endless row across the whole screen, fading out at both edges. The list is drawn twice
 * so the loop has no seam; it pauses under the pointer, and for reduced motion it stands still and scrolls by hand.
 */
function EditorMarquee({ editors }: { editors: NonNullable<HomeContent["editors"]> }) {
	// A handful of people fill less than a screen, so a loop would show them twice side by side: they stand in a row.
	const moving = editors.length >= MARQUEE_MINIMUM;
	const row = (copy: boolean) => (
		// Passing by, each person keeps one line; standing on a narrow screen, the line under the name wraps instead.
		<ul aria-hidden={copy || undefined} className={`flex ${moving ? "shrink-0" : "min-w-0"} ${copy ? "motion-reduce:hidden" : ""}`}>
			{editors.map((editor) => (
				<li key={editor.name} className={`flex items-center gap-4 pr-16 ${moving ? "shrink-0" : "min-w-0"}`}>
					<AuthorAvatar src={editor.photo} alt="" size="lg" className="shrink-0 self-start" />
					<span className={moving ? "whitespace-nowrap" : "min-w-0"}>
						<span className="block font-heading text-lg font-semibold leading-tight">{editor.name}</span>
						{/* One line under the name, so everyone stands the same height; the place is quieter than the role. */}
						{(editor.title || editor.location) && (
							<span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
								{editor.title && <span className="text-sm opacity-90">{editor.title}</span>}
								{editor.location && <span className="inline-flex items-center gap-1 text-xs opacity-75"><HugeiconsIcon icon={Location01Icon} aria-hidden size={13} />{editor.location}</span>}
							</span>
						)}
					</span>
				</li>
			))}
		</ul>
	);
	if (!moving) return <div className="mt-12 flex flex-wrap gap-y-8 lg:mt-16 [&>ul]:flex-wrap [&>ul]:gap-y-8">{row(false)}</div>;
	return (
		<div className="group/marquee relative left-1/2 mt-12 w-screen -translate-x-1/2 overflow-hidden py-2 [mask-image:linear-gradient(to_right,transparent,black_15%,black_85%,transparent)] motion-reduce:overflow-x-auto lg:mt-16">
			<div className="flex w-max animate-marquee group-hover/marquee:[animation-play-state:paused] motion-reduce:animate-none" style={{ animationDuration: `${editors.length * 7}s` }}>
				{row(false)}
				{row(true)}
			</div>
		</div>
	);
}

/** Fewer people than this stand still; from here on they fill more than a screen and pass by. */
const MARQUEE_MINIMUM = 6;

/** The closing band: who runs the library set large, and the ways in as buttons in the band's own colours. */
function Team({ team, teamText, editors, ways, heading }: { team?: string; teamText: React.ReactNode; editors?: HomeContent["editors"]; ways: Way[]; heading: (key: "team" | "involvement") => string }) {
	const people = Boolean(team || editors?.length);
	return (
		<>
			<Heading>{heading(people ? "team" : "involvement")}</Heading>
			{team && <Reading className={leadFor(team)}>{teamText}</Reading>}
			{editors?.length ? <EditorMarquee editors={editors} /> : null}
			<Involvement ways={ways} spaced={people} />
		</>
	);
}

/** One way in: what it is called, what pressing it leads to, and the page or action it opens. */
type Way = { key: string; label: string; hint: string; icon: IconSvgElement; end: IconSvgElement } & ({ href: string } | { onPress: () => void });

/**
 * The ways in the community has on that lead somewhere for this reader. Suggesting papers needs reader accounts.
 * Joining follows where the reader stands: the team's own see Admin, an application sent says so, and the button is
 * gone while the community takes no applications.
 */
function useWays(involvement: HomeContent["involvement"]): Way[] {
	const t = useTranslations("homePage");
	const suggest = useSuggest();
	const accounts = useLibraryFeature("readerAccounts");
	const team = useReaderLinks();
	const join: Way | null = team.admin
		? { key: "join", label: t("joinAdmin"), hint: t("joinAdminHint"), icon: DashboardSquare01Icon, end: ArrowRight01Icon, href: "/admin" }
		: team.join === "waiting"
			? { key: "join", label: t("joinWaiting"), hint: t("joinWaitingHint"), icon: CheckmarkCircle02Icon, end: ArrowUpRight01Icon, onPress: team.openJoin }
			: team.join === "open"
				? { key: "join", label: t("join"), hint: t("joinHint"), icon: UserAdd01Icon, end: ArrowUpRight01Icon, onPress: team.openJoin }
				: null;
	const suggestion: Way = { key: "suggest", label: t("suggest"), hint: t("suggestHint"), icon: InboxIcon, end: ArrowRight01Icon, onPress: () => suggest() };
	return [involvement?.suggestions && accounts ? suggestion : null, involvement?.editors ? join : null].filter((way): way is Way => way !== null);
}

/** The ways in, each a button that says what it does and what follows; `spaced` sets them apart from the people above. */
function Involvement({ ways, spaced }: { ways: Way[]; spaced: boolean }) {
	if (ways.length === 0) return null;
	return (
		<div className={`${spaced ? "mt-12 lg:mt-16" : ""} grid max-w-4xl gap-3 ${ways.length > 1 ? "sm:grid-cols-2" : "sm:max-w-md"}`}>
			{ways.map((way, index) => {
				const first = index === 0;
				const className = `group flex items-center gap-4 rounded-2xl p-5 text-start transition-[transform,background-color] duration-200 active:scale-[0.99] motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(var(--ink-rgb))] ${first ? "bg-[rgb(var(--ink-rgb))] text-[var(--band-bg)] dark:text-[var(--band-bg-dark)]" : "border border-[rgb(var(--ink-rgb)/0.35)] hover:bg-[rgb(var(--ink-rgb)/0.08)]"}`;
				const inside = (
					<>
						<span className={`flex size-12 shrink-0 items-center justify-center rounded-xl ${first ? "bg-[var(--band-bg)] text-[rgb(var(--ink-rgb))] dark:bg-[var(--band-bg-dark)]" : "bg-[rgb(var(--ink-rgb)/0.12)]"}`}>
							<HugeiconsIcon icon={way.icon} aria-hidden size={24} />
						</span>
						<span className="min-w-0 flex-1">
							<span className="block text-lg font-semibold leading-tight">{way.label}</span>
							<span className="mt-1 block text-sm opacity-75">{way.hint}</span>
						</span>
						<HugeiconsIcon icon={way.end} aria-hidden size={20} className="shrink-0 transition-transform duration-200 group-hover:translate-x-1 motion-reduce:transition-none rtl:-scale-x-100" />
					</>
				);
				return "href" in way ? <Link key={way.key} href={way.href} className={className}>{inside}</Link> : <button key={way.key} type="button" onClick={way.onPress} className={className}>{inside}</button>;
			})}
		</div>
	);
}

function toneStyle(tone: Tone, previous?: Tone) {
	return {
		"--band-bg": tone.bg,
		"--band-fg": tone.fg,
		"--band-bg-dark": tone.bgDark,
		"--band-fg-dark": tone.fgDark,
		"--band-fg-rgb": tone.fgRgb,
		"--band-fg-rgb-dark": tone.fgRgbDark,
		"--band-from": previous?.bg ?? "transparent",
		"--band-from-dark": previous?.bgDark ?? "transparent",
	} as React.CSSProperties;
}

const toneClass = "bg-[var(--band-bg)] text-[var(--band-fg)] [--ink-rgb:var(--band-fg-rgb)] dark:bg-[var(--band-bg-dark)] dark:text-[var(--band-fg-dark)] dark:[--ink-rgb:var(--band-fg-rgb-dark)]";

/** The arch a band rises into the previous one with, on a 1600×120 box filled in the previous band's colour. */
const ARCH = "M0 0 H1600 V120 C 1300 0, 300 0, 0 120 Z";

/** Full-width band in a configured tone; the seam at its top is drawn in the previous band's colour. */
function Band({ tone, previous, inverse = false, sections = false, children }: { tone: Tone; previous: Tone; inverse?: boolean; /** Its sections fade in one by one themselves. */ sections?: boolean; children: React.ReactNode }) {
	const ref = useRef<HTMLElement>(null);
	usePauseOffscreen(ref);
	const reduce = useLessMotion();
	// The seam starts shallow and bends to its full curve as the band comes up the screen.
	const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 35%"] });
	const depth = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.25, 1]);
	return (
		<section ref={ref} data-inverse={inverse} className={`group/band relative isolate pb-16 pt-24 lg:pb-24 lg:pt-36 ${toneClass}`} style={toneStyle(tone, previous)}>
			<div aria-hidden className={`pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 ${toneClass}`}>
				{/* One pixel above the band's edge: where the edge falls between pixels, Firefox would otherwise show a hairline of this band's colour above the curve. */}
				<motion.div style={{ scaleY: depth, originY: 0 }} className="absolute inset-x-0 -top-px h-14 motion-reduce:![transform:none] lg:h-24">
					<svg viewBox="0 0 1600 120" preserveAspectRatio="none" className="h-full w-full text-[var(--band-from)] dark:text-[var(--band-from-dark)]">
						<path d={ARCH} fill="currentColor" />
					</svg>
				</motion.div>
			</div>
			{sections ? children : <motion.div {...reveal}>{children}</motion.div>}
		</section>
	);
}

/** Renders its children once they come within about a screen of the viewport; until then the placeholder holds their room. */
function WhenNear({ children, placeholder }: { children: React.ReactNode; placeholder: React.ReactNode }) {
	const ref = useRef<HTMLDivElement>(null);
	// Anything above the screen counts as near, so jumping past a section still draws it.
	const near = useInView(ref, { once: true, margin: "100000px 0px 800px 0px" });
	return <div ref={ref}>{near ? children : placeholder}</div>;
}

/**
 * Marks a section while it is well off screen, so the stylesheet pauses the endless animations inside it (the shelf,
 * the sweeps, the marquees): they otherwise keep the browser busy on every frame for parts nobody can see. Set on the
 * element directly, so scrolling never re-renders the page.
 */
function usePauseOffscreen(ref: React.RefObject<HTMLElement | null>) {
	useEffect(() => {
		const element = ref.current;
		if (!element || typeof IntersectionObserver === "undefined") return;
		const observer = new IntersectionObserver(([entry]) => element.toggleAttribute("data-offscreen", !entry!.isIntersecting), { rootMargin: "100px 0px" });
		observer.observe(element);
		return () => observer.disconnect();
	}, [ref]);
}

/**
 * Room at the foot of the last band for the footer's curved top, which the footer draws itself across the full
 * width of the window (the page is narrower than the window on wide screens).
 */
function FooterSeam({ previous }: { previous: Tone }) {
	return (
		<div aria-hidden className="pointer-events-none relative h-14 lg:h-24" style={toneStyle(previous)}>
			<div className={`absolute inset-y-0 left-1/2 w-screen -translate-x-1/2 ${toneClass}`} />
		</div>
	);
}

/* ---------- shared pieces ---------- */

/** The page's one two-column split: what a thing is on the left, the thing itself on the right. */
const twoColumns = "grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-20";

const muted = "opacity-60";
const rule = "border-t border-[rgb(var(--ink-rgb)/0.1)]";
const percent = (part: number, whole: number) => Math.round((100 * part) / Math.max(1, whole));


/** Every band opens with this: its heading, with a note or link on the right. */
function Heading({ children, note }: { children: React.ReactNode; note?: React.ReactNode }) {
	return (
		<div className="mb-8 flex flex-wrap items-center justify-between gap-x-6 gap-y-1">
			<h2 className="text-[1.75rem] font-bold leading-tight tracking-tight lg:text-3xl">{children}</h2>
			{note && <div className="text-sm">{note}</div>}
		</div>
	);
}

/** A sentence whose figures and names carry the weight: wrap those in <strong>, the rest recedes. */
function Reading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
	return <div className={`font-heading font-semibold tracking-tight text-[rgb(var(--ink-rgb)/0.55)] [&_strong]:font-semibold [&_strong]:text-[rgb(var(--ink-rgb))] ${className}`}>{children}</div>;
}


/* ---------- charts ---------- */

/** What links a chart to its list: the row on show, whether that is a passing preview, and how to change it. */
type Linkage = { shown: number; previewing: boolean; onPreview: (index: number | null) => void; onSelect: (index: number) => void };

const spring = { type: "spring", stiffness: 260, damping: 26 } as const;

/* ---------- motion ---------- */

/**
 * Seen once, a little after the top edge clears the bottom of the screen. Anything already above the screen counts as
 * seen too: a section that loads after the reader has scrolled past it just shows, instead of waiting to be scrolled
 * back into view.
 */
const seen = { once: true, margin: "100000px 0px -8% 0px" } as const;
/**
 * A section that fades up by itself the first time it scrolls into view. Nothing waits on a parent's cue, so a section
 * that arrives after the page has loaded, or while it is already on screen, still animates in.
 */
const reveal = { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: seen, transition: { type: "spring", stiffness: 180, damping: 24 } } as const;

/** A figure that counts up from zero the first time it is seen. The server HTML, and anyone who prefers less motion, get the final value. */
function CountUp({ text }: { text: string }) {
	const locale = useLocale();
	const ref = useRef<HTMLSpanElement>(null);
	const inView = useInView(ref, seen);
	const reduce = useLessMotion();
	useEffect(() => {
		const node = ref.current;
		const read = readNumber(text, locale);
		if (!inView || reduce || !node || !read) return;
		const format = new Intl.NumberFormat(locale, { minimumFractionDigits: read.decimals, maximumFractionDigits: read.decimals });
		const controls = animate(0, read.value, { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: (value) => { node.textContent = read.before + format.format(value) + read.after; } });
		return () => controls.stop();
	}, [inView, reduce, text, locale]);
	return <span ref={ref}>{text}</span>;
}

/** Monotone cubic through the points (Fritsch-Carlson), so the curve never overshoots a value. */
function smoothPath(points: { x: number; y: number }[]) {
	const last = points.length - 1;
	if (last < 1) return "";
	const slope = points.slice(0, -1).map((point, index) => (points[index + 1]!.y - point.y) / (points[index + 1]!.x - point.x));
	const tangent = points.map((_, index) => (index === 0 ? slope[0]! : index === last ? slope[last - 1]! : slope[index - 1]! * slope[index]! <= 0 ? 0 : (slope[index - 1]! + slope[index]!) / 2));
	slope.forEach((value, index) => {
		if (value === 0) { tangent[index] = 0; tangent[index + 1] = 0; return; }
		const length = Math.hypot(tangent[index]! / value, tangent[index + 1]! / value);
		if (length > 3) { tangent[index] = (3 * tangent[index]!) / length; tangent[index + 1] = (3 * tangent[index + 1]!) / length; }
	});
	return points.slice(0, -1).reduce((path, point, index) => {
		const next = points[index + 1]!;
		const third = (next.x - point.x) / 3;
		return `${path} C${point.x + third} ${point.y + tangent[index]! * third}, ${next.x - third} ${next.y - tangent[index + 1]! * third}, ${next.x} ${next.y}`;
	}, `M${points[0]!.x} ${points[0]!.y}`);
}

/** Smallest round number at or above the value, for the top gridline. */
function niceCeiling(value: number) {
	const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, value)));
	return magnitude * ([1, 2, 2.5, 4, 5, 10].find((step) => step * magnitude >= value) ?? 10);
}

/** Change over time: one smooth 2px line over a flat wash, two recessive gridlines, and a crosshair that reads out the point under the pointer. Fills its parent's height. */
function Trend({ points, link, unit, labelEvery = 1, dottedFrom = -1 }: { points: { label: string; value: number }[]; link: Linkage; unit: string; labelEvery?: number; dottedFrom?: number }) {
	const format = useFormatter();
	const tLabels = useTranslations("home");
	const top = niceCeiling(Math.max(...points.map((point) => point.value)));
	const x = (index: number) => (points.length > 1 ? (100 * index) / (points.length - 1) : 50);
	const split = dottedFrom >= 0 && points.length > 1 ? x(Math.max(0, dottedFrom - 1)) : null;
	const y = (value: number) => 100 - (value / top) * 84;
	const line = smoothPath(points.map((point, index) => ({ x: x(index), y: y(point.value) })));
	const shown = points[link.shown];
	const indexAt = (event: React.MouseEvent<HTMLDivElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		return Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - box.left) / box.width) * (points.length - 1))));
	};
	return (
		<div className="flex h-full flex-col" role="img" aria-label={tLabels("publicationsPerTo", { unit, value: points[0]?.label ?? "", value2: points.at(-1)?.label ?? "" })}>
			<div className="relative min-h-0 flex-1 cursor-crosshair touch-pan-y" onPointerMove={(event) => link.onPreview(indexAt(event))} onPointerLeave={() => link.onPreview(null)} onClick={(event) => link.onSelect(indexAt(event))}>
				{[top, top / 2].map((value) => (
					<div key={value} className={`absolute inset-x-0 ${rule}`} style={{ top: `${y(value)}%` }}><span className={`absolute bottom-1 left-0 text-xs tabular-nums ${muted}`}>{format.number(value)}</span></div>
				))}
				<TrendLine line={line} split={split} />
				<div className="absolute inset-x-0 bottom-0 border-t border-[rgb(var(--ink-rgb)/0.25)]" />
				{shown && <Readout point={shown} left={x(link.shown)} top={y(shown.value)} />}
			</div>
			<div className="relative mt-2 h-4">
				{points.map((point, index) => (index % labelEvery === 0 || index === points.length - 1) && (index === points.length - 1 || points.length - 1 - index >= labelEvery) && (
					<span key={point.label} className={`absolute text-xs tabular-nums ${muted} ${index === 0 ? "" : index === points.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${x(index)}%` }}>{point.label}</span>
				))}
			</div>
		</div>
	);
}

/** The trend's line and wash, drawn in from the left once seen; from `split` on the line is dotted, for the years still being counted. */
function TrendLine({ line, split }: { line: string; split: number | null }) {
	const clipId = useId();
	return (
		<motion.div className="absolute inset-0 text-accent motion-reduce:![clip-path:none]" initial={{ clipPath: "inset(0 100% 0 0)" }} whileInView={{ clipPath: "inset(0 0% 0 0)" }} viewport={seen} transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}>
			<svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full overflow-visible">
				{split !== null && (
					<defs>
						<clipPath id={`${clipId}-solid`}><rect x={-1} y={-1} width={split + 1} height={102} /></clipPath>
						<clipPath id={`${clipId}-dotted`}><rect x={split} y={-1} width={101 - split} height={102} /></clipPath>
					</defs>
				)}
				<path d={`${line} L100 100 L0 100 Z`} fill="currentColor" opacity={0.16} />
				<path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" clipPath={split !== null ? `url(#${clipId}-solid)` : undefined} />
				{split !== null && <path d={line} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeDasharray="0 6" vectorEffect="non-scaling-stroke" clipPath={`url(#${clipId}-dotted)`} />}
			</svg>
		</motion.div>
	);
}

/** The crosshair on the point on show, with its value; near an edge the label keeps inside the chart. */
function Readout({ point, left, top }: { point: { label: string; value: number }; left: number; top: number }) {
	const format = useFormatter();
	return (
		<div className="pointer-events-none absolute inset-y-0" style={{ left: `${left}%` }}>
			<div className="absolute inset-y-0 -ml-px border-l border-[rgb(var(--ink-rgb)/0.35)]" />
			<div className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--band-bg)] bg-accent dark:border-[var(--band-bg-dark)]" style={{ top: `${top}%` }} />
			<p className={`absolute top-0 whitespace-nowrap bg-[var(--band-bg)] px-2 text-sm dark:bg-[var(--band-bg-dark)] ${left > 75 ? "right-0" : left < 25 ? "left-0" : "-translate-x-1/2"}`}><span className="font-bold tabular-nums">{format.number(point.value)}</span> <span className={muted}>{point.label}</span></p>
		</div>
	);
}

type Rect = { x: number; y: number; w: number; h: number };

/** Squarified treemap layout on a 100×100 box; rows are laid out in the order given. */
function squarify(values: number[], box: Rect): Rect[] {
	const total = values.reduce((sum, value) => sum + value, 0);
	if (total <= 0 || values.length === 0) return values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
	const scale = (box.w * box.h) / total;
	const areas = values.map((value) => value * scale);
	const out: Rect[] = [];
	let rest = box;
	let index = 0;
	while (index < areas.length) {
		const horizontal = rest.w >= rest.h;
		const { count, run } = nextStrip(areas, index, horizontal ? rest.h : rest.w);
		const thickness = run / (horizontal ? rest.h : rest.w);
		out.push(...layStrip(areas.slice(index, index + count), rest, horizontal, thickness));
		rest = horizontal ? { ...rest, x: rest.x + thickness, w: rest.w - thickness } : { ...rest, y: rest.y + thickness, h: rest.h - thickness };
		index += count;
	}
	return out;
}

/** How many cells from `start` go in the next strip along a side this long: cells are added while the least square one keeps getting squarer. */
function nextStrip(areas: number[], start: number, side: number) {
	let run = 0;
	let count = 0;
	let worst = Infinity;
	for (let next = start; next < areas.length; next += 1) {
		const candidate = run + areas[next]!;
		const ratio = worstRatio(areas.slice(start, next + 1), candidate / side);
		if (ratio > worst && count > 0) break;
		worst = ratio;
		run = candidate;
		count += 1;
	}
	return { count, run };
}

/** The long side over the short side of the least square cell, for cells of these areas in a strip this thick. */
function worstRatio(areas: number[], thickness: number) {
	return Math.max(...areas.map((area) => { const length = area / thickness; return Math.max(thickness / length, length / thickness); }));
}

/** Cells of these areas side by side in one strip along the box's left or top edge. */
function layStrip(areas: number[], box: Rect, horizontal: boolean, thickness: number): Rect[] {
	let offset = 0;
	return areas.map((area) => {
		const length = area / thickness;
		const cell = horizontal ? { x: box.x, y: box.y + offset, w: thickness, h: length } : { x: box.x + offset, y: box.y, w: length, h: thickness };
		offset += length;
		return cell;
	});
}

/** Part-to-whole as a treemap in the accent ramp, largest darkest, each cell with its own readable text colour and a 2px gap to its neighbours. The cell on show lifts above the rest instead of wearing an outline. */
function Treemap({ rows, total, toneOf, link }: { rows: Row[]; total: number; toneOf: (index: number) => Tone; link: Linkage }) {
	const format = useFormatter();
	const tLabels = useTranslations("home");
	const reduce = useLessMotion();
	const rects = squarify(rows.map((row) => row.count), { x: 0, y: 0, w: 100, h: 100 });
	return (
		<div className="relative h-full w-full" onPointerLeave={() => link.onPreview(null)}>
			{rows.map((row, index) => {
				const rect = rects[index]!;
				const current = index === link.shown;
				return (
					<motion.div key={row.name} className={`absolute motion-reduce:!opacity-100 motion-reduce:![transform:none] ${current ? "z-10" : ""}`} style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={seen} transition={{ ...spring, delay: index * 0.04 }}>
						<button type="button" aria-pressed={current} aria-label={tLabels("label", { name: row.name, number: format.number(row.count), value: percent(row.count, total) })} onPointerEnter={() => link.onPreview(index)} onFocus={() => link.onPreview(index)} onBlur={() => link.onPreview(null)} onClick={() => link.onSelect(index)} className={`absolute flex flex-col justify-end overflow-hidden rounded-xl p-3 text-left outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink-rgb))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent motion-reduce:transition-none ${toneClass} ${current ? "-inset-0.5 shadow-[0_8px_24px_rgb(0_0_0/0.2)]" : `inset-px ${link.previewing ? "opacity-50" : ""}`}`} style={toneStyle(toneOf(index))}>
							{rect.w > 12 && rect.h > 16 && <span className={`min-w-0 flex-col ${rect.w > 28 ? "flex" : "hidden sm:flex"}`}><span className="truncate text-sm font-semibold">{row.name}</span><span className="font-heading text-2xl font-semibold leading-none tabular-nums">{format.number(row.count)}<span className="ml-1.5 text-sm font-normal opacity-75">{percent(row.count, total)}%</span></span></span>}
						</button>
					</motion.div>
				);
			})}
		</div>
	);
}

/** The list beside every chart: swatch, name, share and count. Hovering previews a row in the chart, clicking keeps it. */
function Ranked({ rows, total, toneOf, link }: { rows: Row[]; total?: number; toneOf?: (index: number) => Tone; link: Linkage }) {
	const format = useFormatter();
	const list = useRef<HTMLOListElement>(null);
	// Keep the row on show inside the list's own scroll box without ever scrolling the page.
	useEffect(() => {
		const box = list.current;
		const row = box?.children[link.shown];
		if (!box || !(row instanceof HTMLElement)) return;
		if (row.offsetTop < box.scrollTop) box.scrollTop = row.offsetTop;
		else if (row.offsetTop + row.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = row.offsetTop + row.offsetHeight - box.clientHeight;
	}, [link.shown]);
	return (
		<ol ref={list} className="relative h-full overflow-y-auto pr-2 [scrollbar-gutter:stable]" onPointerLeave={() => link.onPreview(null)}>
			{rows.map((row, index) => (
				<li key={row.name}>
					<button type="button" aria-pressed={index === link.shown} onPointerEnter={() => link.onPreview(index)} onFocus={() => link.onPreview(index)} onBlur={() => link.onPreview(null)} onClick={() => link.onSelect(index)} className={`flex w-full min-w-0 items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:bg-[rgb(var(--ink-rgb)/0.12)] ${index === link.shown ? "bg-[rgb(var(--ink-rgb)/0.08)]" : ""}`}>
						{toneOf && <span aria-hidden className={`size-3 shrink-0 rounded-[4px] ${toneClass}`} style={toneStyle(toneOf(index))} />}
						{row.flag && <CountryFlag countryCode={row.flag} className="h-3.5 w-5 shrink-0 rounded-[3px]" />}
						<TruncatedText text={row.name} className="flex-1 text-base font-medium" />
						{total ? <span className={`text-sm tabular-nums ${muted}`}>{percent(row.count, total)}%</span> : null}
						<span className="w-12 shrink-0 text-right text-lg font-bold tabular-nums">{format.number(row.count)}</span>
					</button>
				</li>
			))}
		</ol>
	);
}

/**
 * Publications as the library shows them: its result card, in the two-column grid the item page uses for related publications.
 * In dark mode the card is a 4% white film, which assumes the library's neutral page beneath it; each one gets that page colour
 * as a backing, so on a tinted band it comes out the same grey as in the library instead of letting the band through.
 */
function PublicationList({ items, className = "" }: { items: (ListItem | undefined)[]; className?: string }) {
	const handOff = use(HandOff);
	// The cards change with every row and tab the explorer shows, so their entrance is a CSS animation on mount, which
	// always ends visible; the band around them already rises into view as a whole. A missing item is a placeholder card.
	// The hand-off listens while the click travels down, because the gap-map card's "View details" button stops it on the way up.
	return <ul className={`flex flex-col gap-4 md:grid md:grid-cols-2 ${className}`}>{items.map((item, index) => <li key={item?.key ?? index} onClickCapture={handOff(item).onClick} className="animate-hero-rise rounded-xl motion-reduce:animate-none dark:bg-background" style={{ animationDelay: `${index * 90}ms` }}><Resource as="div" itemData={item} isLoading={!item} abstract={false} className="h-full" hideUnapi /></li>)}</ul>;
}

/* ---------- explorer ---------- */

type View = {
	key: string;
	title: string;
	icon: IconSvgElement;
	rows: Row[];
	total?: number;
	/** Row on show when the tab opens. */
	initial?: number;
	/** Swatch per row, for the views whose chart colours its parts. */
	toneOf?: (index: number) => Tone;
	/** The finding for the row on show, as a sentence. */
	reading: (row: Row, index: number) => React.ReactNode;
	chart: (link: Linkage) => React.ReactNode;
};

/** One panel for every view: the finding as a sentence, a fixed-height chart beside its list, then publications behind the row on show. Every part has a fixed height, so neither tabs nor rows move the page. */
function ExplorerPanel({ view, data, surface }: { view: View; data: HomeData; surface: Tone }) {
	const format = useFormatter();
	const tLabels = useTranslations("home");
	const [selected, setSelected] = useState(view.initial ?? 0);
	const [preview, setPreview] = useState<number | null>(null);
	const shown = preview ?? selected;
	const row = view.rows[shown]!;
	const link: Linkage = { shown, previewing: preview !== null, onPreview: setPreview, onSelect: setSelected };
	return (
		<>
			<div className={`rounded-2xl p-5 lg:p-8 ${toneClass}`} style={toneStyle(surface)}>
			<Reading className="min-h-[4.6em] text-2xl leading-[1.15] sm:min-h-[2.3em] lg:text-[28px]">{view.reading(row, shown)}</Reading>
			<div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-12">
				<div className="flex h-[20rem] min-w-0 items-center lg:h-[24rem]">{view.chart(link)}</div>
				<div className="h-[16rem] min-w-0 lg:h-[24rem]"><Ranked rows={view.rows} total={view.total} toneOf={view.toneOf} link={link} /></div>
			</div>
				<p className={`mt-8 pt-4 text-sm ${rule} ${muted}`}>{tLabels("countedFromTheLibraryOn", { dateFormat: format.dateTime(data.updated, SHORT_DATE) })}</p>
			</div>
			{row.filter && <RowExamples row={row} filter={row.filter} fallback={data.examples[examplesKey(row.filter)]} />}
			<WhenNear placeholder={null}><WarmRows rows={view.rows} from={view.initial ?? 0} examples={data.examples} /></WhenNear>
		</>
	);
}

/** How many rows around the one a tab opens on have their publications fetched ahead. */
const WARM_ROWS = 8;

/**
 * Once the explorer nears the screen and the browser is idle, fetches the publications of the rows around the one the
 * tab opens on, so moving to them shows their cards at once. Only the nearest eight: about as many as the list shows
 * without scrolling on a wide screen, and every row a tab of types, collections or topics has, while a tab of years or
 * countries can hold a hundred.
 */
function WarmRows({ rows, from, examples }: { rows: Row[]; from: number; examples: HomeData["examples"] }) {
	const { cache } = useSWRConfig();
	const keys = rows
		.map((row, index) => ({ row, distance: Math.abs(index - from) }))
		.sort((a, b) => a.distance - b.distance)
		.flatMap(({ row }) => (row.filter && row.count > 0 ? [examplesKey(row.filter)] : []))
		.filter((key) => !examples[key])
		.slice(0, WARM_ROWS)
		.join("\n");
	const warm = useCallback(() => Promise.allSettled(keys.split("\n").filter((key) => key && cache.get(key)?.data === undefined).map((key) => preload(key, fetcher))), [keys, cache]);
	useIdlePreload(warm);
	return null;
}

/** The row's own newest publications, the first of what "See all" opens. */
function RowExamples({ row, filter, fallback }: { row: Row; filter: string; fallback?: ItemsGetResponse }) {
	const format = useFormatter();
	const tLabels = useTranslations("home");
	const locale = useLocale();
	// The server sent each tab's first row and the rows around it were fetched ahead, so neither is asked for again.
	// Any other row shows placeholder cards while it loads, never another row's publications under its name.
	const { data: examples, isLoading } = useSWR<ItemsGetResponse>(examplesKey(filter), fetcher, { fallbackData: fallback, revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false });
	return (
		<div className="mt-8">
			<div className="mb-4 flex items-baseline justify-between gap-6">
				<h3 className="flex min-w-0 items-center gap-2 text-xl font-medium">{row.flag && <CountryFlag countryCode={row.flag} className="h-3.5 w-5 shrink-0 rounded-[3px]" />}<TruncatedText text={row.name} /></h3>
				{/* The default prefetch: every row shown would otherwise download its whole filtered list, which few readers open. */}
				<div className="shrink-0 whitespace-nowrap text-sm"><TextLink href={`/lib?${filter}`} prefetch={null}>{tLabels("seeAll", { number: format.number(examples?.totalItems ?? row.count) })}</TextLink></div>
			</div>
			<PublicationList items={examples?.items ?? (isLoading ? [undefined, undefined] : [])} className="min-h-[27rem] md:min-h-[12rem] [&>li]:min-h-[13.5rem] md:[&>li]:min-h-[12rem]" />
		</div>
	);
}

type Fact = { icon: IconSvgElement; value: string; label: string; detail: string };

function Facts({ data }: { data: HomeData }) {
	// A fact whose figure is zero says the library has no such data yet, not something about its publications, so it is left out.
	const tLabels = useTranslations("home");
	const format = useFormatter();
	const facts = [...shareFacts(data, tLabels, format), ...countFacts(data, tLabels, format)].filter((fact): fact is Fact => Boolean(fact));
	if (facts.length === 0) return null;
	return (
		<dl className={`mt-14 grid grid-cols-2 gap-x-8 gap-y-10 pt-12 sm:grid-cols-3 lg:grid-cols-6 ${rule}`}>
			{facts.map((fact) => (
				<div key={fact.label} className="flex flex-col-reverse justify-end gap-2">
					<dt><span className="flex items-start gap-1.5 text-sm font-medium leading-snug"><HugeiconsIcon icon={fact.icon} aria-hidden size={16} className="mt-0.5 shrink-0" />{fact.label}</span><span className={`mt-1 block text-xs ${muted}`}>{fact.detail}</span></dt>
					<dd className="font-heading text-4xl font-semibold leading-none tracking-tight tabular-nums"><CountUp text={fact.value} /></dd>
				</div>
			))}
		</dl>
	);
}

/** The facts that are a share of the library: the percentage, over how many of all the publications. */
function shareFacts(data: HomeData, tLabels: HomeTranslator, format: Formatter) {
	const share = (icon: IconSvgElement, part: number | undefined, label: string) => part && { icon, value: `${format.number(percent(part, data.publications) / 100, { style: "percent" })}`, label, detail: tLabels("factOf", { part: format.number(part), whole: format.number(data.publications) }) };
	return [
		share(Pdf01Icon, data.attachments?.withPdf, tLabels("factPdf")),
		share(QuoteUpIcon, data.citations?.itemsWith, tLabels("factCited")),
		share(Globe02Icon, data.collaboration?.collaborative, tLabels("factCollaboration")),
	];
}

/** The facts that are counts, each with its own detail. */
function countFacts(data: HomeData, tLabels: HomeTranslator, format: Formatter) {
	return [
		data.citations?.total && { icon: Analytics01Icon, value: format.number(data.citations.total), label: tLabels("factCitations"), detail: tLabels("factPerPublication", { value: format.number(data.citations.average) }) },
		data.citations?.hIndex && { icon: Layers01Icon, value: format.number(data.citations.hIndex), label: tLabels("factHIndex"), detail: tLabels("factMostCited", { value: format.number(data.citations.max) }) },
		data.productivity?.multiple && { icon: UserMultipleIcon, value: format.number(data.productivity.multiple), label: tLabels("factAuthors"), detail: tLabels("factPerAuthor", { value: format.number(data.productivity.average) }) },
	];
}

function Explorer({ data, shapes, tones, ramp, today }: { data: HomeData; shapes: MapShape[]; tones: Tones; ramp: Tone[]; today: string }) {
	const tLabels = useTranslations("home");
	const tItemType = useTranslations("itemType");
	const locale = useLocale();
	const otherType = tLabels("other");
	const otherOrNone = tLabels("otherOrNone");
	const [tab, setTab] = useState<string | null>(null);
	const config = useLibraryConfig();
	const countries = Object.keys(data.countries).length;
	const countryName = useCountryName();
	const listed = listedRows(data, config, today, countryName);
	const { series, busiest } = listed;

	const types = [...data.itemTypes].sort((a, b) => b.count - a.count).slice(0, 6).map((row) => ({ name: tItemType.has(row.itemType as never) ? tItemType(row.itemType as never) : humanType(row.itemType).replace(/^./, (first) => first.toUpperCase()), count: row.count }));
	const otherTypes = data.publications - types.reduce((sum, row) => sum + row.count, 0);
	/**
	 * The rows plus one for every publication they leave out, so the tiles share out the whole library as the
	 * percentages do. Only for views where each publication counts once: a publication in two collections would
	 * make the tiles add up to more than the library.
	 */
	const withRest = (rows: Row[]) => {
		const rest = data.publications - rows.reduce((sum, row) => sum + row.count, 0);
		return rest > 0 ? [...rows, { name: otherOrNone, count: rest }] : rows;
	};

	const rampOf = (rows: Row[]) => (index: number) => ramp[Math.round((index * (ramp.length - 1)) / Math.max(1, rows.length - 1))]!;
	/** A part-to-whole view: treemap in the ramp, shares counted against the library unless the rows are a top list. */
	const parts = (view: Pick<View, "key" | "title" | "icon" | "reading">, rows: Row[], total?: number): View => ({ ...view, rows, total, toneOf: rampOf(rows), chart: (link) => <Treemap rows={rows} total={total ?? rows.reduce((sum, row) => sum + row.count, 0)} toneOf={rampOf(rows)} link={link} /> });
	const flip = (index: number) => series.length - 1 - index;
	const countryRows = listed.countries;
	const reading = (key: Parameters<typeof tLabels.rich>[0], row: Row, values: Record<string, string | number> = {}) => tLabels.rich(key, { strong, count: row.count, name: row.name, percent: percent(row.count, data.publications), ...values });

	const allViews: View[] = [
		{ key: "years", title: tLabels("byYear"), icon: Calendar03Icon, rows: listed.years, initial: busiest, reading: (row, index) => reading(index === busiest ? "reading.busiestYear" : "reading.fromYear", row), chart: (link) => <div className="h-full w-full"><Trend points={series} link={{ ...link, shown: flip(link.shown), onPreview: (index) => link.onPreview(index === null ? null : flip(index)), onSelect: (index) => link.onSelect(flip(index)) }} unit="year" labelEvery={series.length > 14 ? 3 : series.length > 8 ? 2 : 1} dottedFrom={series.findIndex((point) => Number(point.label) >= Number(today.slice(0, 4)))} /></div> },
		parts({ key: "types", title: tLabels("byType"), icon: Layers01Icon, reading: (row) => reading(row.name === otherType ? "reading.otherType" : "reading.type", row, { name: locale.startsWith("en") ? plural(row.name) : row.name })}, otherTypes > 0 ? [...types, { name: otherType, count: otherTypes }] : types, data.publications),
		{ key: "countries", title: tLabels("byCountry"), icon: Globe02Icon, rows: countryRows, reading: (row, index) => reading(index === 0 ? "reading.leadingCountry" : "reading.aboutCountry", row, { countries }), chart: (link) => <HomeMap shapes={shapes} countries={data.countries} bubbles className="w-full text-accent" active={countryRows[link.shown]?.flag} dim={link.previewing} onHover={(code) => link.onPreview(code ? countryRows.findIndex((row) => row.flag === code) : null)} onSelect={(code) => link.onSelect(countryRows.findIndex((row) => row.flag === code))} /> },
		parts({ key: "collections", title: tLabels("collections"), icon: Folder01Icon, reading: (row) => reading("reading.collection", row)}, listed.collections, data.publications),
		parts({ key: "topics", title: tLabels("topics"), icon: Tag01Icon, reading: (row) => reading("reading.topic", row, { name: row.name.toLowerCase() })}, listed.topics),
		parts({ key: "languages", title: tLabels("languages"), icon: LanguageSkillIcon, reading: (row) => reading(row.name === otherOrNone ? "reading.otherLanguage" : "reading.language", row)}, withRest(data.languages), data.publications),
		parts({ key: "institutions", title: tLabels("institutions"), icon: UniversityIcon, reading: (row) => reading("reading.institution", row)}, listed.institutions),
		parts({ key: "publishers", title: tLabels("publishers"), icon: Building03Icon, reading: (row) => reading(row.name === otherOrNone ? "reading.otherPublisher" : "reading.publisher", row)}, withRest(data.publishers), data.publications),
		parts({ key: "journals", title: tLabels("journals"), icon: Book02Icon, reading: (row) => reading(row.name === otherOrNone ? "reading.otherJournal" : "reading.journal", row)}, withRest(data.journals), data.publications),
	];
	const views = allViews.filter((item) => item.rows.some((row) => row.count > 0));
	const view = views.find((item) => item.key === tab) ?? views[0];
	if (!view) return <p className="text-lg opacity-70">{tLabels("figuresAboutTheLibraryWillAppear")}</p>;

	return (
		<>
			{/* The tab strip only. NextUI mounts its own panel after hydration, which made the explorer pop in late and push the page down; the panel below is ours, so it is in the server HTML. */}
			<Tabs aria-label={tLabels("exploreTheData")} color="card" size="lg" selectedKey={view?.key} onSelectionChange={(key) => setTab(String(key))} classNames={{ base: "max-w-full", tabList: "max-w-full overflow-x-auto", tab: "w-auto flex-none md:px-5", panel: "hidden" }}>
				{views.map((item) => <Tab key={item.key} title={<span className="flex items-center gap-2"><HugeiconsIcon icon={item.icon} aria-hidden size={16} />{item.title}</span>} />)}
			</Tabs>
			<div role="tabpanel" aria-label={view.title} className="pt-4"><ExplorerPanel key={view.key} view={view} data={data} surface={tones.card} /></div>
			<Facts data={data} />
		</>
	);
}


/** Renders `children` with the library's figures once they arrive; until then its own box holds the space. */
function WithData({ data, children }: { data: Promise<HomeData>; children: (data: HomeData) => React.ReactNode }) {
	return <>{children(use(data))}</>;
}

/** `today` is the server's date, so the citation's access date is the same in the server's page and the browser's. */
type Props = { name: string; siteUrl: string; today: string; about: HomeContent; rich: HomeRich; data: Promise<HomeData>; tones: Tones; ramp: Tone[]; shapes: MapShape[] };

/**
 * Everything the library wrote and the page's structure render at once; the parts built from the library's figures
 * stream in behind their own boundaries as the data arrives, each in a box that already has its final size.
 */
/** The library list, with or without a locale prefix or filters; a record's own page (/lib/<key>) is not it. */
const LIBRARY_LIST_PATH = /^(?:\/[a-z]{2}(?:-[A-Z]{2})?)?\/lib\/?$/;

/**
 * A link from here to the library list opens the list itself, so it closes the chat beside the list if a question
 * left it open. The questions that ask the library (marked data-asks-library) keep it open.
 */
function useCloseChatForListLinks() {
	const { setEngaged } = useInlineChatLayout();
	return (event: React.MouseEvent) => {
		const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
		if (!link || link.hasAttribute("data-asks-library")) return;
		const { origin, pathname } = new URL(link.href);
		if (origin === window.location.origin && LIBRARY_LIST_PATH.test(pathname)) setEngaged(false);
	};
}

export default function HomePage(props: Props) {
	const closeChatForListLinks = useCloseChatForListLinks();
	return (
		<MotionConfig reducedMotion="user">
			<HandOffProvider>
				<div className="contents" onClickCapture={closeChatForListLinks}>
					<PageContainer className="flex flex-col py-0 lg:py-0 xl:py-0">
						<Hero name={props.name} intro={props.rich.intro} data={props.data} tone={props.tones.page} shapes={props.shapes} />
						<Bands {...props} />
					</PageContainer>
				</div>
			</HandOffProvider>
		</MotionConfig>
	);
}

/** The inside band before the figures arrive, at the height its sections take. */
const insidePlaceholder = <div className="h-[220rem] lg:h-[124.3rem]" />;

/**
 * The home page while the server is still sending it, on a first load or on Back: the hero with its map, its words
 * holding their place unseen, and the first band at its height. The words then rise in with the page as on any load,
 * and the footer never shows under the bar.
 */
export function HomePlaceholder({ intro }: { intro?: React.ReactNode }) {
	const { identity, theme } = useLibraryConfig();
	const { tones } = tonesFrom(theme.colors);
	return (
		<PageContainer className="flex flex-col py-0 lg:py-0 xl:py-0">
			<Hero name={identity.name} intro={intro} tone={tones.page} shapes={[]} />
			<Band tone={tones.card} previous={tones.page} sections>{insidePlaceholder}</Band>
		</PageContainer>
	);
}

/** Without `data` it is the placeholder's hero: no figures, and the words unseen. */
function Hero({ name, intro, data, tone, shapes }: { name: string; intro?: React.ReactNode; data?: Promise<HomeData>; tone: Tone; shapes: MapShape[] }) {
	const ref = useRef<HTMLElement>(null);
	usePauseOffscreen(ref);
	return (
		<section ref={ref} className={`relative isolate pb-16 pt-10 lg:pb-24 lg:pt-16 ${toneClass}`} style={toneStyle(tone)}>
			<HeroBackdrop data={data} shapes={shapes} />
			{data && <Suspense fallback={null}><WithData data={data}>{(figures) => <HeroShelf data={figures} />}</WithData></Suspense>}
			<HeroText name={name} intro={intro} unseen={!data} />
		</section>
	);
}

/** The map behind the hero, the row of first pages below xl, and the wash that keeps the text readable over them. */
function HeroBackdrop({ data, shapes }: { data?: Promise<HomeData>; shapes: MapShape[] }) {
	const reduce = useLessMotion();
	const map = (countries: Record<string, number>) => <HomeMap shapes={shapes} countries={countries} cover className="absolute inset-0 text-accent opacity-40" />;
	// The map behind the hero drifts at a fraction of the scroll, so the page reads as layered.
	const { scrollY } = useScroll();
	const drift = useTransform(scrollY, [0, 900], [0, reduce ? 0 : -120]);
	return (
		<div aria-hidden className={`pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden ${toneClass}`}>
			{/* The map fills the hero and drifts up as the page scrolls, so its southern coasts are never pushed out of view. */}
			<motion.div className="absolute inset-0" style={{ y: drift }}>
				{data ? <Suspense fallback={map({})}><WithData data={data}>{(figures) => map(figures.countries)}</WithData></Suspense> : map({})}
			</motion.div>
			{data && <Suspense fallback={null}><WithData data={data}>{(figures) => <HeroRow data={figures} />}</WithData></Suspense>}
			{/* A wash of the page colour behind the text, so the map shows only faintly where people read; it fades out before the covers. */}
			<div className="absolute inset-0 bg-[linear-gradient(to_right,var(--band-bg)_0%,var(--band-bg)_22%,transparent_62%)] dark:bg-[linear-gradient(to_right,var(--band-bg-dark)_0%,var(--band-bg-dark)_22%,transparent_62%)] opacity-90 max-xl:bg-[linear-gradient(to_bottom,transparent_0%,transparent_10rem,var(--band-bg)_14rem)] max-xl:dark:bg-[linear-gradient(to_bottom,transparent_0%,transparent_10rem,var(--band-bg-dark)_14rem)] sm:max-xl:bg-[linear-gradient(to_bottom,transparent_0%,transparent_18rem,var(--band-bg)_21rem)] sm:max-xl:dark:bg-[linear-gradient(to_bottom,transparent_0%,transparent_18rem,var(--band-bg-dark)_21rem)]" />
		</div>
	);
}

/** Name and tagline read as one unit; the intro is supporting text, set apart and softer; then the actions. */
function HeroText({ name, intro, unseen = false }: { name: string; intro?: React.ReactNode; unseen?: boolean }) {
	const tLabels = useTranslations("home");
	const { identity, notifications } = useLibraryConfig();
	// A library that uploaded its own logo leads its hero with it; the platform's stand-in logo is left in the bar.
	const ownLogo = hasOwnLogo(identity.assets);
	return (
		<div className={`relative flex min-h-[26rem] flex-col items-start justify-end pt-44 sm:pt-60 lg:min-h-[32rem] xl:pt-36 ${unseen ? "invisible" : ""}`}>
			<div className="flex flex-col gap-5">
				{/* With its own logo, the logo is the heading; the name stays the page's heading for screen readers and search. */}
				{ownLogo ? (
					<div className="animate-hero-rise motion-reduce:animate-none" aria-hidden>
						<LibraryLogo place="hero" />
					</div>
				) : null}
				<h1 className={ownLogo ? "sr-only" : "max-w-[16ch] animate-hero-rise text-balance text-5xl font-bold leading-[0.98] tracking-[-0.03em] motion-reduce:animate-none sm:text-6xl"}>{name}</h1>
				{identity.tagline && <p className="max-w-[31rem] animate-hero-rise text-balance font-heading text-xl font-medium leading-snug tracking-tight text-[rgb(var(--ink-rgb)/0.72)] [animation-delay:90ms] motion-reduce:animate-none sm:text-2xl">{identity.tagline}</p>}
			</div>
			{intro && <div className="mt-8 max-w-[34rem] animate-hero-rise text-[17px] leading-7 text-[rgb(var(--ink-rgb)/0.75)] [animation-delay:140ms] motion-reduce:animate-none [&_p]:mb-0 [&_p]:max-w-none [&_p]:text-[length:inherit] [&_p]:leading-[inherit] [&_p]:opacity-100 [&_strong]:text-[rgb(var(--ink-rgb))]">{intro}</div>}
			<div className="mt-10 flex animate-hero-rise flex-wrap gap-3 [animation-delay:180ms] motion-reduce:animate-none">
				<Button as={Link} href="/lib" color="accent" variant="solid" size="md" startContent={<HugeiconsIcon icon={Search01Icon} aria-hidden size={18} />}>{tLabels("exploreTheLibrary")}</Button>
				{/* The digest button offers a subscription, so it goes when the library sends no digests. */}
				{notifications.enabled ? <Button as={Link} href="/digests" variant="muted" size="md" startContent={<HugeiconsIcon icon={Notification03Icon} aria-hidden size={18} />}>{tLabels("getTheDigest")}</Button> : null}
			</div>
		</div>
	);
}

/** Each answered question gets a band of its own, in the order the page reads; a blank one drops out and the seams close up. */

function headingOf(about: HomeContent, key: keyof NonNullable<HomeContent["headings"]>) {
	return about.headings?.[key]?.trim();
}

/** Where a typed number's separators sit in this language: a dot groups thousands in German and marks decimals in English. */
function readNumber(text: string, locale: string) {
	const parts = new Intl.NumberFormat(locale).formatToParts(1234567.8);
	const group = parts.find((part) => part.type === "group")?.value ?? "";
	const decimal = parts.find((part) => part.type === "decimal")?.value ?? ".";
	const escape = (mark: string) => mark.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = text.match(new RegExp(`\\d[\\d${escape(group)}]*(?:${escape(decimal)}\\d+)?`));
	if (!match) return null;
	const plain = match[0].replaceAll(group || "\u0000", "").replace(decimal, ".");
	return { value: Number(plain), decimals: plain.split(".")[1]?.length ?? 0, before: text.slice(0, match.index), after: text.slice(match.index! + match[0].length) };
}

function Bands({ name, siteUrl, today, about, rich, data, tones, ramp, shapes }: Props) {
	const tLabels = useTranslations("home");
	const t = useTranslations("homePage");
	const { citations } = useLibraryConfig();
	const heading = (key: keyof NonNullable<HomeContent["headings"]>) => headingOf(about, key) || t(key);
	// The ways in are offered only where they lead somewhere for this reader.
	const ways = useWays(about.involvement);
	const bands = [
		{
			key: "inside",
			tone: tones.card,
			sections: true,
			body: (
				<Suspense fallback={insidePlaceholder}>
					<WithData data={data}>{(figures) => <Inside data={figures} surface={tones.tertiary} questions={about.questions} />}</WithData>
				</Suspense>
			),
		},
		{
			key: "explore",
			tone: tones.tint,
			body: (
				<>
					<Heading>{tLabels("exploreTheData")}</Heading>
					<Suspense fallback={<div className="h-[120rem] lg:h-[71rem]" />}>
						<WithData data={data}>{(figures) => <motion.div {...reveal}><Explorer data={figures} shapes={shapes} tones={tones} ramp={ramp} today={today} /></motion.div>}</WithData>
					</Suspense>
				</>
			),
		},
		hasCuration(about.curation) && { key: "curation", tone: tones.deep, body: <Curation curation={about.curation!} statement={rich.curation} heading={heading("curation")} data={data} /> },
		// The library's citation, with the owner's closing answer beside it; with citations off and no answer, no band.
		(citations.enabled || about.extra?.text.trim()) && { key: "cite", tone: tones.card, body: <Cite extra={about.extra} answerText={rich.extra} cites={citations.enabled} name={name} siteUrl={siteUrl} today={today} /> },
		hasTeam(about, ways) && { key: "team", tone: tones.tertiary, body: <Team team={about.team} teamText={rich.team} editors={about.editors} ways={ways} heading={heading} /> },
	].filter((band): band is { key: string; tone: Tone; sections?: boolean; body: React.JSX.Element } => Boolean(band));

	return (
		<>
			{bands.map((band, index) => <Band key={band.key} tone={band.tone} previous={bands[index - 1]?.tone ?? tones.page} inverse={band.tone === tones.deep || band.tone === tones.tertiary} sections={band.sections}>{band.body}</Band>)}

			<FooterSeam previous={bands.at(-1)?.tone ?? tones.card} />
		</>
	);
}

function hasCuration(curation: HomeContent["curation"]) {
	return Boolean(curation?.text || curation?.steps?.length);
}

/** The team band has people to show, words about them, or a way in that leads somewhere. */
function hasTeam(about: HomeContent, ways: Way[]) {
	return Boolean(about.team || about.editors?.length || ways.length);
}

/** The owner's closing answer, if any, beside how to cite the library; with citations off, the answer alone at full width. */
function Cite({ extra, answerText, cites, name, siteUrl, today }: { extra: HomeContent["extra"]; answerText: React.ReactNode; cites: boolean; name: string; siteUrl: string; today: string }) {
	const tLabels = useTranslations("home");
	const answer = extra?.text.trim() ? extra.text : undefined;
	return (
		<>
			<Heading>{extra?.title?.trim() || (cites ? tLabels("citeTheLibrary") : name)}</Heading>
			<div className={answer && cites ? twoColumns : ""}>
				{answer && <div className="max-w-[40rem]">{answerText}</div>}
				{cites && <CiteSlip name={name} url={siteUrl} today={today} />}
			</div>
		</>
	);
}
