"use client";

import { Suspense, use, useEffect, useId, useRef, useState } from "react";
import type { Element } from "hast";
import { animate, MotionConfig, motion, useInView, useReducedMotion, useScroll, useTransform } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { serializeSearchParams } from "@/lib/searchParams";
import { fetcher } from "@/lib/utils";
import type { ItemsGetResponse } from "@/app/api/items/types";
import { exampleQuestions } from "./home-content";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Link, useRouter } from "@/i18n/routing";
import { BsStars } from "react-icons/bs";
import { Input } from "@/components/nextui/Input";
import { AskAIButton } from "@/components/features/ai/AskAIButton";
import { handOverQuestion } from "@/components/features/ai/handed-over-question";
import PageContainer from "@/components/layout/PageContainer";
import { Button } from "@/components/nextui/Button";
import { Tab, Tabs } from "@/components/nextui/Tabs";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { CountryFlag } from "@/components/statistics/CountryFlag";
import { TextLink } from "@/components/digests/DigestPrimitives";
import { DigestCover } from "@/components/digests/DigestCover";
import type { DigestSummary } from "@/lib/notifications/public";
import { CitationPanel } from "@/components/features/items/CitationControl";
import { PdfCover } from "@/components/features/items/PdfCover";
import { AuthorAvatar } from "@/components/authors/AuthorAvatar";
import type { CitationItem } from "@/lib/citation-formats";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { hasOwnLogo, LibraryLogo } from "@/components/library/LibraryIdentity";
import Resource from "@/components/features/items/Resource";
import type { ListItem } from "@/app/api/item/types";
import HomeMap, { type MapShape } from "./HomeMap";
import { Analytics01Icon, Book02Icon, Mail01Icon, UserAdd01Icon, Building03Icon, Calendar03Icon, Folder01Icon, Globe02Icon, LanguageSkillIcon, Layers01Icon, Notification03Icon, Pdf01Icon, QuoteUpIcon, Search01Icon, Tag01Icon, UniversityIcon, UserMultipleIcon } from "@hugeicons/core-free-icons";
import type { IconSvgElement } from "@hugeicons/react";

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
	topics: { name: string; count: number }[];
	languages: { name: string; count: number }[];
	publishers: { name: string; count: number }[];
	journals: { name: string; count: number }[];
	recent: ListItem[];
	/** Each country's place in the listing's region filter ("Africa > Eastern Africa > KE"), by country code. */
	countryPaths: Record<string, string>;
	/** First pages of the recent publications that have a PDF, by publication key. */
	covers: Record<string, string>;
	/** The most recent submission an editor published, followed from submission to publication. */
	journey: { key: string; title: string; submittedAt: string; reviewer: { name: string; photo: string | null } | null; publishedAt: string; doi: string | null } | null;
	/** The most cited publications, for the citations preview. */
	cited: { key: string; title: string; citations: number }[];
	/** Whether the library's assistant answers questions across the library (`features.aiSearch`). */
	ai: boolean;
	/** The latest published digests, newest first. */
	digests: { library: string; timezone: string; editions: DigestSummary[] } | null;
	attachments: { total: number; itemsWith: number; percentage: number } | null;
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
export type StepType = "arrival" | "check" | "publication" | "text";

export type HomeContent = {
	/** One short paragraph under the library's tagline (Identity) in the hero. */
	intro?: string;
	/**
	 * The steps a publication takes into the library. A step's type decides what the timeline fills in from the
	 * publication it follows: the date it arrived, the editor who checked it, its DOI; a text step is its words only.
	 * `editor` is a chosen person from the team, shown on an editor check instead of whoever approved it.
	 */
	curation?: { text?: string; steps?: { title: string; text: string; type?: StepType; editor?: { name: string; photo?: string } }[] };
	team?: string;
	/** The people who run the library, shown in the team band. `photo` is an image address. */
	editors?: { name: string; title?: string; location?: string; photo?: string }[];
	/** Up to three example questions for the Ask box; an empty slot keeps the one made from the library's topics. */
	questions?: string[];
	/** The publication the steps follow, by key; without one they follow the latest reviewed publication. */
	followed?: string;
	involvement?: { suggestions: boolean; editors: boolean };
	extra?: { title?: string; text: string };
	headings?: Partial<Record<"curation" | "team" | "involvement", string>>;
};

type Rendered = { children?: React.ReactNode; node?: Element };

const link = ({ children, node }: Rendered) => <Link href={String(node?.properties.href ?? "")} className="font-medium text-accent underline decoration-1 underline-offset-4">{children}</Link>;
const bold = ({ children }: Rendered) => <strong className="font-semibold opacity-100">{children}</strong>;
const body = {
	p: ({ children }: Rendered) => <p className="mb-4 max-w-[40rem] text-[17px] leading-[1.75] opacity-85 last:mb-0">{children}</p>,
	ul: ({ children }: Rendered) => <ul className="mb-4 max-w-[40rem] list-disc space-y-1 pl-5 text-[17px] leading-[1.75] opacity-85 marker:text-current last:mb-0 [&_p]:mb-0 [&_p]:opacity-100">{children}</ul>,
	a: link,
	strong: bold,
};
const statement = { p: ({ children }: Rendered) => <p className="mb-4 last:mb-0">{children}</p>, a: link, strong: bold };

/** Text from the bold-and-links editor. Anything else in it is unwrapped to its words; bare addresses become links. */
function RichText({ text, as = body }: { text: string; as?: Partial<typeof body> }) {
	return <ReactMarkdown remarkPlugins={[remarkGfm]} allowedElements={["p", "strong", "em", "a", "ul", "li"]} unwrapDisallowed components={as}>{text}</ReactMarkdown>;
}

/** A band's lead sentence, set large under its header; the same size wherever it appears. */
const leadStatement = "max-w-[30ch] text-3xl leading-[1.12] text-[rgb(var(--ink-rgb)/0.7)] lg:text-5xl lg:leading-[1.08]";
/** A long lead sentence steps down a size, so it stays a statement rather than a wall. */
const leadFor = (text: string) => (text.length > 180 ? "max-w-[40ch] text-2xl leading-[1.2] text-[rgb(var(--ink-rgb)/0.7)] lg:text-[2rem] lg:leading-[1.18]" : leadStatement);


/** The parts every library has, shown under "Inside the library" with a live look at each. Not configurable. */
type Part = "publications" | "ai" | "citations" | "digests";

const shortDate = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });
/** A conic light spun on the spot; the Ask console draws it behind its question box as a ring and as a glow. */
const turningLight = <span aria-hidden className="absolute left-1/2 top-1/2 -ml-[80%] -mt-[80%] aspect-square w-[160%] animate-spin bg-[conic-gradient(from_0deg,transparent_0deg,rgb(var(--color-accent-300))_50deg,rgb(var(--color-accent-500))_110deg,transparent_170deg,transparent_360deg)] [animation-duration:5s] motion-reduce:animate-none" />;

/** The example questions on the Ask console: a pill that brightens under the pointer; the text keeps the band's colour. */
const chip = "inline-flex items-center gap-2 rounded-full border border-[rgb(var(--ink-rgb)/0.14)] bg-[rgb(var(--ink-rgb)/0.06)] py-2 pl-3 pr-4 text-sm font-medium outline-offset-2 backdrop-blur-sm transition-colors hover:border-[rgb(var(--ink-rgb)/0.35)] hover:bg-[rgb(var(--ink-rgb)/0.14)]";
/** A list entry in a preview: spacing only; the rules belong to the rows around it. */
const previewItem = "py-2.5 first:pt-0 last:pb-0";
const previewLink = "group flex gap-6 outline-offset-4";

/** Where each kind of item leads, and what the link says. */
const destinations: Record<Part, { href: string; label: string } | null> = {
	publications: { href: "/lib", label: "Browse the library" },
	ai: null,
	citations: null,
	digests: { href: "/digests", label: "All digests" },
};

// ponytail: English only, like the page's other fixed wording; move it to the message catalogs when the page is translated.
const parts: { shows: Part; title: string; text: string; has: (data: HomeData) => boolean }[] = [
	{ shows: "publications", title: "Publications", text: "The latest additions, each with its abstract and, where the licence allows, the PDF.", has: (data) => data.recent.length > 0 },
	{ shows: "ai", title: "Ask the library", text: "Answers come from the publications and their full text, and name their sources.", has: (data) => data.ai },
	{ shows: "citations", title: "Citations", text: "The publications cited most often. Each page links to what it cites and what cites it.", has: (data) => data.cited.length > 0 },
	{ shows: "digests", title: "Digests", text: "A regular summary of new additions.", has: (data) => Boolean(data.digests?.editions.length) },
];

function Preview({ shows, data, surface, questions }: { shows: Part; data: HomeData; surface: Tone; questions?: string[] }) {
	const locale = useLocale();
	switch (shows) {
		case "publications":
			return (
				<ol className="grid grid-cols-2 gap-x-5 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
					{data.recent.slice(0, 6).map((item) => (
						<li key={item.key}>
							<Link href={`/lib/${item.key}`} className="group block outline-offset-4">
								<span className="block shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1.5 motion-reduce:transition-none [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
									<PdfCover src={data.covers[item.key]} alt="" sizes="(min-width: 1024px) 208px, (min-width: 640px) 33vw, 50vw" />
								</span>
								<span className="mt-3 line-clamp-3 text-sm font-medium leading-snug transition-colors group-hover:text-accent">{item.title}</span>
								{item.datePublished && <span className="mt-1 block text-xs tabular-nums opacity-60">{shortDate.format(new Date(item.datePublished))}</span>}
							</Link>
						</li>
					))}
				</ol>
			);
		case "ai":
			return <AskPreview data={data} surface={surface} questions={questions} />;
		case "citations":
			return (
				<ol className="grid gap-x-10 gap-y-8 sm:grid-cols-3">
					{data.cited.map((row) => (
						<li key={row.key}>
							<Link href={`/lib/${row.key}`} className="group flex gap-5 outline-offset-4">
								<span className="block w-24 shrink-0 shadow-md transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:-translate-y-1 motion-reduce:transition-none [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
									<PdfCover src={data.covers[row.key]} alt="" sizes="96px" />
								</span>
								<span className="min-w-0 pt-1">
									<span className="block font-heading text-4xl font-semibold leading-none tabular-nums">{number.format(row.citations)}</span>
									<span className="mt-1 block text-sm opacity-60">{row.citations === 1 ? "citation" : "citations"}</span>
									<span className="mt-3 line-clamp-3 text-base font-medium leading-snug transition-colors group-hover:text-accent">{row.title}</span>
								</span>
							</Link>
						</li>
					))}
				</ol>
			);
		case "digests": {
			const [latest] = data.digests?.editions ?? [];
			if (!data.digests || !latest) return null;
			return (
				<div className="grid gap-12 lg:grid-cols-[28rem_minmax(0,1fr)] lg:gap-20">
					<div className="pr-4 pt-2">
						<DigestCover edition={latest} libraryName={data.digests.library} timezone={data.digests.timezone} href={`/digests/${latest.slug}`} locale={locale} titleAs="h3" />
					</div>
					{data.digests.editions.length > 1 && (
						<div>
							<h3 className="text-sm font-semibold opacity-75">Earlier issues</h3>
							<ol className="mt-3">
								{data.digests.editions.slice(1).map((edition) => (
									<li key={edition.slug} className="border-b border-[rgb(var(--ink-rgb)/0.1)] py-4 last:border-b-0">
										<Link href={`/digests/${edition.slug}`} className="group block outline-offset-4">
											<span className="block text-sm tabular-nums opacity-60">{shortDate.format(new Date(edition.publishedAt))}</span>
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
	}
}

/**
 * How to cite the library itself, through the same citation panel as every publication (styles, picker, copy). The
 * library is described as a web page read today, built from its name and address, so no library has to write it.
 */
function CiteSlip({ name, url }: { name: string; url: string }) {
	const { citations } = useLibraryConfig();
	if (!citations.enabled) return null;
	const library: CitationItem = { key: "library", title: name, itemType: "Webpage", url, accessDate: new Date().toISOString().slice(0, 10) };
	// The block a publication page shows, so citing the library looks like citing anything else in it.
	return <CitationPanel item={library} showHeading completeRecord link={url} />;
}


/**
 * The assistant, ready to use: a question box that opens the library with the question asked, and three examples
 * built from the library's own topics and countries so they fit whatever it holds.
 */
/** Types the example questions into an empty, idle box one after another; a plain hint for reduced motion. */
function useTypedHint(examples: string[], idle: string, active: boolean) {
	const reduce = useReducedMotion();
	const [hint, setHint] = useState<string | null>(null);
	const joined = examples.join("\n");
	const typing = Boolean(joined) && active && !reduce;
	useEffect(() => {
		if (!typing) return;
		const list = joined.split("\n");
		let example = 0;
		let length = 0;
		let erasing = false;
		let timer = 0;
		const tick = () => {
			const current = list[example]!;
			length += erasing ? -1 : 1;
			setHint(current.slice(0, length));
			if (!erasing && length === current.length) {
				erasing = true;
				timer = window.setTimeout(tick, 2000);
			} else if (erasing && length === 0) {
				erasing = false;
				example = (example + 1) % list.length;
				timer = window.setTimeout(tick, 400);
			} else timer = window.setTimeout(tick, erasing ? 16 : 45);
		};
		timer = window.setTimeout(tick, 900);
		return () => window.clearTimeout(timer);
	}, [joined, typing]);
	const [caret, setCaret] = useState(true);
	useEffect(() => {
		if (!typing) return;
		const blink = window.setInterval(() => setCaret((shown) => !shown), 530);
		return () => window.clearInterval(blink);
	}, [typing]);
	return typing && hint !== null ? `${hint}${caret ? "▍" : ""}` : idle;
}

/**
 * The library as a field of dots, one per publication up to a screenful, lighting up in a slow sweep: the assistant
 * reading the collection. Faded in the middle, where the question box sits; still for reduced motion.
 */
function LibraryField({ publications }: { publications: number }) {
	// Roughly one row's worth, so the delay by position sweeps across the panel from left to right.
	const row = 44;
	const count = Math.min(publications, row * 13);
	return (
		<div aria-hidden className="pointer-events-none absolute inset-0 grid content-center justify-center gap-6 p-6 [grid-template-columns:repeat(auto-fill,5px)] [mask-image:radial-gradient(ellipse_at_center,transparent_10%,black_45%)]">
			{Array.from({ length: count }, (_, index) => (
				<span key={index} className="size-[5px] animate-read-dot rounded-full bg-[rgb(var(--color-accent-300))] shadow-[0_0_8px_rgb(var(--color-accent-400))] motion-reduce:animate-none motion-reduce:opacity-30" style={{ animationDelay: `${((index % row) / row) * 2.4 + ((index * 7) % 11) * 0.09}s` }} />
			))}
		</div>
	);
}

function AskPreview({ data, surface, questions }: { data: HomeData; surface: Tone; questions?: string[] }) {
	const router = useRouter();
	const [question, setQuestion] = useState("");
	const [focused, setFocused] = useState(false);
	const examples = exampleQuestions(data, (code) => regionNames.of(code) ?? code, questions).filter((example): example is string => Boolean(example));
	const submit = () => {
		if (!question.trim()) return;
		handOverQuestion(question.trim());
		router.push("/lib");
	};
	const hint = useTypedHint(examples, "Ask anything about the research here", !question && !focused);
	return (
		<div className={`relative isolate overflow-hidden rounded-3xl px-6 py-12 sm:px-10 lg:py-16 ${toneClass}`} style={toneStyle(surface)}>
			<LibraryField publications={data.publications} />
			<div className="relative mx-auto max-w-3xl">
				{/* A turning light runs around the box: spun behind it, it shows as a thin ring, with a blurred copy as its glow. */}
				<div className="relative">
					<div aria-hidden className="absolute -inset-1.5 overflow-hidden rounded-[24px] opacity-80 blur-xl">{turningLight}</div>
					<div className="relative overflow-hidden rounded-[18px] p-[3px]">
						{turningLight}
						<Input
							aria-label="Ask the library a question"
							value={question}
							onValueChange={setQuestion}
							onKeyDown={(event) => {
								if (event.key === "Enter") submit();
							}}
							onFocus={() => setFocused(true)}
							onBlur={() => setFocused(false)}
							placeholder={hint}
							size="lg"
							// Solid on hover: the shared field's hover tint would let the turning light show through it. Its own text
							// colour: it sits on the dark panel, whose white text it would otherwise take on.
							classNames={{ base: "relative", inputWrapper: "h-14 min-h-14 rounded-2xl pr-2 shadow-none !bg-white dark:!bg-secondary", input: "text-black dark:text-white" }}
							endContent={<AskAIButton hint="↵" onAsk={submit} />}
						/>
					</div>
				</div>
				{examples.length > 0 && (
					<ul className="mt-6 flex flex-wrap content-start justify-center gap-2.5">
						{examples.map((example) => (
							<li key={example}>
								<Link href="/lib" onClick={() => handOverQuestion(example)} className={chip}>
									<BsStars aria-hidden className="size-3.5 shrink-0 text-[rgb(var(--color-accent-400))]" />
									{example}
								</Link>
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
	return (
		<motion.ul {...listMotion}>
			{parts.filter((part) => part.has(data)).map((part) => {
				const destination = destinations[part.shows];
				return (
					<motion.li key={part.shows} variants={arrive} className="border-t border-[rgb(var(--ink-rgb)/0.1)] py-12 first:border-t-0 first:pt-0 lg:py-14 lg:first:pt-0">
						<div className="mb-8 flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
							<div>
								<h2 className="text-[1.75rem] font-bold leading-tight tracking-tight lg:text-3xl">{part.title}</h2>
								<p className="mt-2 max-w-[40rem] text-base leading-7 opacity-75">{part.text}</p>
							</div>
							{destination && <TextLink href={destination.href}>{destination.label}</TextLink>}
						</div>
						<Preview shows={part.shows} data={data} surface={surface} questions={questions} />
					</motion.li>
				);
			})}
		</motion.ul>
	);
}

/** On the accent band: the editors' statement set large, then the path an entry takes, side by side under big numerals. */
function Curation({ curation, heading, data }: { curation: NonNullable<HomeContent["curation"]>; heading: string; data: Promise<HomeData> }) {
	const steps = curation.steps?.length ? curation.steps : null;
	if (!curation.text && !steps) return null;
	return (
		<>
			<Heading>{heading}</Heading>
			{curation.text && <Reading className={leadFor(curation.text)}><RichText text={curation.text} as={statement} /></Reading>}
			{steps && (
				<div className={curation.text ? "mt-16 lg:mt-20" : ""}>
					<Suspense fallback={<Timeline steps={steps} journey={null} />}>
						<WithData data={data}>{(figures) => <Timeline steps={steps} journey={figures.journey} cover={figures.journey ? figures.covers[figures.journey.key] : undefined} />}</WithData>
					</Suspense>
				</div>
			)}
		</>
	);
}

type Step = NonNullable<NonNullable<HomeContent["curation"]>["steps"]>[number];

const longDay = new Intl.DateTimeFormat("en", { day: "numeric", month: "long", year: "numeric" });

/** Timeline columns on wide screens, one per step; below that the steps run down one vertical track. */
const TIMELINE_COLUMNS: Record<number, string> = { 1: "", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4", 5: "lg:grid-cols-5" };

/** What a step's type shows, from the publication the timeline follows (or the editor chosen for it). */
function happened(step: Step, journey: HomeData["journey"]): { when?: string; body?: React.ReactNode } {
	switch (step.type) {
		case "arrival":
			return journey ? { when: journey.submittedAt, body: <>Arrived for review</> } : {};
		case "check": {
			const editor = step.editor ?? journey?.reviewer;
			const body = editor ? (
				<span className="flex items-center gap-3">
					<AuthorAvatar src={editor.photo ?? undefined} alt="" size="md" className="shrink-0" />
					<span>Checked by <strong className="font-semibold">{editor.name}</strong></span>
				</span>
			) : undefined;
			return { when: journey?.publishedAt, body };
		}
		case "publication":
			return journey ? { when: journey.publishedAt, body: <>Published{journey.doi && <> with the DOI <a href={`https://doi.org/${journey.doi}`} className="font-semibold underline decoration-1 underline-offset-4">{journey.doi}</a></>}</> } : {};
		default:
			return {};
	}
}

/**
 * The steps on one track, each a node with its date above and its name, what happened and its words below. Following
 * a reviewed publication, its first page stands at the start of the track; without one the track carries the steps.
 */
function Timeline({ steps, journey, cover }: { steps: Step[]; journey: HomeData["journey"]; cover?: string }) {
	const dated = steps.some((step) => happened(step, journey).when);
	const track = `absolute inset-x-0 hidden h-0.5 rounded-full lg:block ${journey ? "lg:-left-16" : ""} [mask-image:linear-gradient(to_right,black_78%,transparent)] ${dated ? "top-[43px]" : "top-[7px]"}`;
	const timeline = (
		<motion.ol {...listMotion} className={`relative grid gap-x-10 gap-y-10 ${TIMELINE_COLUMNS[Math.min(steps.length, 5)]}`}>
			<span aria-hidden className={`${track} bg-[rgb(var(--ink-rgb)/0.18)]`} />
			<motion.span aria-hidden initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} viewport={seen} transition={{ duration: 1.6, ease: [0.16, 1, 0.3, 1], delay: 0.2 }} className={`${track} origin-left bg-[rgb(var(--color-accent-700))]`} />
			{steps.map((step, index) => {
				const { when, body } = happened(step, journey);
				return (
					<motion.li key={`${step.title}-${index}`} variants={arrive} className="relative pl-10 lg:pl-0">
						{/* Below lg the track runs down the left: each step draws the stretch to the next, the last one fades out. */}
						<span aria-hidden className={`absolute left-[7px] top-4 w-0.5 bg-[rgb(var(--color-accent-700))] lg:hidden ${index === steps.length - 1 ? "h-16 [mask-image:linear-gradient(to_bottom,black,transparent)]" : "-bottom-10"}`} />
						{/* On wide screens the dates share one row above the track, so every node sits on the line. */}
						{dated ? <p className={`font-heading text-base font-semibold leading-6 tabular-nums lg:h-6 ${when ? "" : "hidden lg:block"}`}>{when ? <time dateTime={when}>{longDay.format(new Date(when))}</time> : null}</p> : null}
						<span aria-hidden className={`absolute left-0 top-1 block size-4 rounded-full border-2 border-[rgb(var(--color-accent-700))] bg-[var(--band-bg)] shadow-[0_0_0_4px_var(--band-bg),0_0_14px_rgb(var(--color-accent-700)/0.6)] dark:bg-[var(--band-bg-dark)] dark:shadow-[0_0_0_4px_var(--band-bg-dark),0_0_14px_rgb(var(--color-accent-700)/0.6)] lg:relative lg:left-auto lg:top-auto ${dated ? "lg:mt-3" : ""}`} />
						<h3 className={`font-heading text-xl font-semibold tracking-tight lg:mt-7 ${dated && when ? "mt-1" : ""}`}>{step.title}</h3>
						{body ? <div className="mt-3 text-base leading-7">{body}</div> : null}
						{step.text ? <p className={`mt-3 leading-6 ${body ? "text-sm opacity-75" : "text-base"}`}>{step.text}</p> : null}
					</motion.li>
				);
			})}
		</motion.ol>
	);
	if (!journey) return timeline;
	return (
		<div className="grid gap-10 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-16">
			{/* The publication as a printed thing: turned towards its journey, pages showing at the edge, a light passing
			    over it as it comes into view; it turns to face the reader under the pointer. */}
			<Link href={`/lib/${journey.key}`} aria-label={journey.title} className="group relative z-10 block max-w-[12rem] self-start outline-offset-4 [perspective:1100px]">
				<span className="relative block rounded-xl shadow-[3px_3px_0_-1px_#f6f3ec,4px_4px_0_-1px_rgb(0_0_0/0.2),7px_7px_0_-2px_#ebe6da,8px_8px_0_-2px_rgb(0_0_0/0.2),28px_32px_44px_-14px_rgb(0_0_0/0.6)] transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] [transform:rotateY(20deg)_rotateX(4deg)] group-hover:[transform:rotateY(0deg)_rotateX(0deg)] motion-reduce:transition-none motion-reduce:[transform:none] [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
					<PdfCover src={cover} alt="" sizes="192px" />
					{/* The cover triggers the sweep: the light starts clipped outside it, where it could never be seen to be in view. */}
					<motion.span aria-hidden initial="rest" whileInView="swept" viewport={seen} className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
						<motion.span variants={{ rest: { x: "-110%" }, swept: { x: "110%", transition: { duration: 2.4, delay: 0.8, ease: [0.45, 0, 0.25, 1] } } }} className="absolute -inset-y-1/4 left-0 w-[150%] -skew-x-[22deg] bg-[linear-gradient(100deg,transparent_22%,rgb(255_255_255/0.06)_38%,rgb(255_255_255/0.2)_50%,rgb(255_255_255/0.06)_62%,transparent_78%)] mix-blend-screen" />
					</motion.span>
				</span>
			</Link>
			{timeline}
		</div>
	);
}

/**
 * Below xl the wall does not fit beside the text: one row of the newest first pages crosses the top of the hero on a
 * rising diagonal instead, drifting along its own line and running up under the navigation bar. It sits in the hero's
 * background, under the wash that keeps the text readable, so it fades out as it reaches the text.
 */
function HeroRow({ data }: { data: HomeData }) {
	const covered = data.recent.filter((publication) => data.covers[publication.key]);
	if (covered.length < 4) return null;
	const row = [...covered, ...covered];
	return (
		<div aria-hidden className="absolute inset-x-0 top-0 h-80 overflow-hidden sm:h-96 xl:hidden">
			<div className="absolute left-1/2 top-[30%] w-[240%] sm:top-[42%] -translate-x-1/2 -translate-y-1/2 -rotate-[20deg] sm:-rotate-[12deg] [mask-image:linear-gradient(to_right,transparent,black_25%,black_75%,transparent)]">
				<div className="flex w-max animate-marquee motion-reduce:animate-none" style={{ animationDuration: `${covered.length * 7}s` }}>
					{row.map((publication, index) => (
						<span key={`${publication.key}-${index}`} className="block w-32 shrink-0 pr-4 sm:w-40">
							<span className="block overflow-hidden rounded-xl shadow-lg [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
								<PdfCover src={data.covers[publication.key]} alt="" sizes="(min-width: 640px) 144px, 112px" />
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
	const covered = data.recent.filter((publication) => data.covers[publication.key]);
	if (covered.length < 4) return null;
	// Every column carries every cover, each starting further along, so three columns never show the same row.
	const turned = (by: number) => [...covered.slice(by % covered.length), ...covered.slice(0, by % covered.length)];
	const column = (publications: ListItem[], down: boolean) => (
		<div className={`flex w-44 shrink-0 flex-col animate-marquee-up group-hover/shelf:[animation-play-state:paused] motion-reduce:animate-none ${down ? "[animation-direction:reverse]" : ""}`} style={{ animationDuration: `${publications.length * 12}s` }}>
			{[...publications, ...publications].map((publication, index) => {
				const copy = index >= publications.length;
				return (
					<Link key={`${publication.key}-${index}`} href={`/lib/${publication.key}`} aria-hidden={copy || undefined} tabIndex={copy ? -1 : undefined} aria-label={copy ? undefined : publication.title ?? undefined} className={`block pb-5 outline-offset-4 ${copy ? "motion-reduce:hidden" : ""}`}>
						<span className="block overflow-hidden rounded-xl shadow-lg [&_img]:aspect-[3/4] [&_img]:object-cover [&_img]:object-top">
							<PdfCover src={data.covers[publication.key]} alt="" sizes="176px" />
						</span>
					</Link>
				);
			})}
		</div>
	);
	return (
				<div className="group/shelf absolute bottom-6 top-0 hidden w-[40rem] xl:-right-14 animate-hero-rise overflow-hidden [animation-delay:300ms] [mask-composite:intersect] [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_74%,transparent),linear-gradient(to_right,transparent,black_30%)] motion-reduce:animate-none xl:block">
			<div className="flex h-full -rotate-[8deg] justify-end gap-5 pr-2">
				{column(turned(0), false)}
				<div className="pt-28">{column(turned(2), true)}</div>
				<div className="pt-10">{column(turned(4), false)}</div>
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
		<ul aria-hidden={copy || undefined} className={`flex shrink-0 ${copy ? "motion-reduce:hidden" : ""}`}>
			{editors.map((editor) => (
				<li key={editor.name} className="flex shrink-0 items-center gap-4 pr-16">
					<AuthorAvatar src={editor.photo} alt="" size="lg" className="shrink-0" />
					<span className="whitespace-nowrap">
						<span className="block font-heading text-lg font-semibold leading-tight">{editor.name}</span>
						{editor.title && <span className="mt-1 block text-sm opacity-75">{editor.title}</span>}
						{editor.location && <span className="block text-sm opacity-75">{editor.location}</span>}
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
function Team({ team, editors, involvement, contactEmail, heading }: { team?: string; editors?: HomeContent["editors"]; involvement?: HomeContent["involvement"]; contactEmail: string | null; heading: (key: "team" | "involvement") => string }) {
	const t = useTranslations("homePage");
	const write = (subject: string) => (contactEmail ? `mailto:${contactEmail}?subject=${encodeURIComponent(subject)}` : "/contact");
	const buttons = [
		involvement?.suggestions && { label: t("suggest"), icon: Mail01Icon, href: write(t("suggestSubject")) },
		involvement?.editors && { label: t("join"), icon: UserAdd01Icon, href: write(t("joinSubject")) },
	].filter((button): button is { label: string; icon: IconSvgElement; href: string } => Boolean(button));
	return (
		<>
			<Heading>{heading(team || editors?.length ? "team" : "involvement")}</Heading>
			{team && <Reading className={leadFor(team)}><RichText text={team} as={statement} /></Reading>}
			{editors && editors.length > 0 && <EditorMarquee editors={editors} />}
			{buttons.length > 0 && (
				<div className={`${team || editors?.length ? "mt-12 lg:mt-16" : ""} flex flex-wrap gap-3`}>
					{buttons.map((button, index) => (
						<Button key={button.label} as={button.href.startsWith("/") ? Link : "a"} href={button.href} size="md" startContent={<HugeiconsIcon icon={button.icon} aria-hidden size={18} />} className={index === 0 ? "bg-[rgb(var(--ink-rgb))] font-semibold dark:bg-[rgb(var(--ink-rgb))] text-[var(--band-bg)] dark:text-[var(--band-bg-dark)]" : "border border-[rgb(var(--ink-rgb)/0.35)] bg-transparent font-semibold text-current"}>{button.label}</Button>
					))}
				</div>
			)}
		</>
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
function Band({ tone, previous, inverse = false, children }: { tone: Tone; previous: Tone; inverse?: boolean; children: React.ReactNode }) {
	const ref = useRef<HTMLElement>(null);
	const reduce = useReducedMotion();
	// The seam starts shallow and bends to its full curve as the band comes up the screen.
	const { scrollYProgress } = useScroll({ target: ref, offset: ["start end", "start 35%"] });
	const depth = useTransform(scrollYProgress, [0, 1], [reduce ? 1 : 0.25, 1]);
	return (
		<section ref={ref} data-inverse={inverse} className={`group/band relative isolate pb-16 pt-24 lg:pb-24 lg:pt-36 ${toneClass}`} style={toneStyle(tone, previous)}>
			<div aria-hidden className={`pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 ${toneClass}`}>
				{/* One pixel above the band's edge: where the edge falls between pixels, Firefox would otherwise show a hairline of this band's colour above the curve. */}
				<motion.div style={{ scaleY: depth, originY: 0 }} className="absolute inset-x-0 -top-px h-14 lg:h-24">
					<svg viewBox="0 0 1600 120" preserveAspectRatio="none" className="h-full w-full text-[var(--band-from)] dark:text-[var(--band-from-dark)]">
						<path d={ARCH} fill="currentColor" />
					</svg>
				</motion.div>
			</div>
			<motion.div initial="hidden" whileInView="shown" viewport={seen} variants={rise}>{children}</motion.div>
		</section>
	);
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

const number = new Intl.NumberFormat("en");
const regionNames = new Intl.DisplayNames(["en"], { type: "region" });
const dateFormat = new Intl.DateTimeFormat("en", { day: "numeric", month: "short", year: "numeric" });
const muted = "opacity-60";
const rule = "border-t border-[rgb(var(--ink-rgb)/0.1)]";
const percent = (part: number, whole: number) => Math.round((100 * part) / Math.max(1, whole));

/** A row of the explorer. `filter` is the listing's query for its publications, where the listing can filter by it. */
type Row = { name: string; count: number; filter?: string; flag?: string };

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

/** Seen once, a little after the top edge clears the bottom of the screen. */
const seen = { once: true, margin: "0px 0px -8% 0px" } as const;
const rise = { hidden: { opacity: 0, y: 32 }, shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 140, damping: 22 } } } as const;
const cascade = { hidden: {}, shown: { transition: { staggerChildren: 0.09 } } } as const;
const arrive = { hidden: { opacity: 0, y: 24 }, shown: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 180, damping: 24 } } } as const;
/** A list whose items arrive one after another the first time it scrolls into view. Its items must not change afterwards. */
const listMotion = { initial: "hidden", whileInView: "shown", viewport: seen, variants: cascade } as const;

/** A figure that counts up from zero the first time it is seen. The server HTML, and anyone who prefers less motion, get the final value. */
function CountUp({ text }: { text: string }) {
	const ref = useRef<HTMLSpanElement>(null);
	const inView = useInView(ref, seen);
	const reduce = useReducedMotion();
	useEffect(() => {
		const node = ref.current;
		const match = text.match(/\d[\d,]*(?:\.\d+)?/);
		if (!inView || reduce || !node || !match) return;
		const decimals = match[0].split(".")[1]?.length ?? 0;
		const format = new Intl.NumberFormat("en", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
		const [before, after] = [text.slice(0, match.index), text.slice(match.index! + match[0].length)];
		const controls = animate(0, Number(match[0].replace(/,/g, "")), { duration: 1.4, ease: [0.16, 1, 0.3, 1], onUpdate: (value) => { node.textContent = before + format.format(value) + after; } });
		return () => controls.stop();
	}, [inView, reduce, text]);
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
function Trend({ points, link, unit, labelEvery = 1, dottedLast = false }: { points: { label: string; value: number }[]; link: Linkage; unit: string; labelEvery?: number; dottedLast?: boolean }) {
	const reduce = useReducedMotion();
	const clipId = useId();
	const top = niceCeiling(Math.max(...points.map((point) => point.value)));
	const x = (index: number) => (points.length > 1 ? (100 * index) / (points.length - 1) : 50);
	const split = dottedLast && points.length > 1 ? x(points.length - 2) : null;
	const y = (value: number) => 100 - (value / top) * 84;
	const line = smoothPath(points.map((point, index) => ({ x: x(index), y: y(point.value) })));
	const shown = points[link.shown];
	const indexAt = (event: React.MouseEvent<HTMLDivElement>) => {
		const box = event.currentTarget.getBoundingClientRect();
		return Math.max(0, Math.min(points.length - 1, Math.round(((event.clientX - box.left) / box.width) * (points.length - 1))));
	};
	return (
		<div className="flex h-full flex-col" role="img" aria-label={`Publications per ${unit}, ${points[0]?.label} to ${points[points.length - 1]?.label}`}>
			<div className="relative min-h-0 flex-1 cursor-crosshair touch-pan-y" onPointerMove={(event) => link.onPreview(indexAt(event))} onPointerLeave={() => link.onPreview(null)} onClick={(event) => link.onSelect(indexAt(event))}>
				{[top, top / 2].map((value) => (
					<div key={value} className={`absolute inset-x-0 ${rule}`} style={{ top: `${y(value)}%` }}><span className={`absolute bottom-1 left-0 text-xs tabular-nums ${muted}`}>{number.format(value)}</span></div>
				))}
				<motion.div className="absolute inset-0 text-accent" initial={reduce ? false : { clipPath: "inset(0 100% 0 0)" }} whileInView={{ clipPath: "inset(0 0% 0 0)" }} viewport={{ once: true }} transition={{ duration: 0.7, ease: [0.25, 0.46, 0.45, 0.94] }}>
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
				<div className="absolute inset-x-0 bottom-0 border-t border-[rgb(var(--ink-rgb)/0.25)]" />
				{shown && (
					<div className="pointer-events-none absolute inset-y-0" style={{ left: `${x(link.shown)}%` }}>
						<div className="absolute inset-y-0 -ml-px border-l border-[rgb(var(--ink-rgb)/0.35)]" />
						<div className="absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--band-bg)] bg-accent dark:border-[var(--band-bg-dark)]" style={{ top: `${y(shown.value)}%` }} />
						<p className={`absolute top-0 whitespace-nowrap bg-[var(--band-bg)] px-2 text-sm dark:bg-[var(--band-bg-dark)] ${x(link.shown) > 75 ? "right-0" : x(link.shown) < 25 ? "left-0" : "-translate-x-1/2"}`}><span className="font-bold tabular-nums">{number.format(shown.value)}</span> <span className={muted}>{shown.label}</span></p>
					</div>
				)}
			</div>
			<div className="relative mt-2 h-4">
				{points.map((point, index) => (index % labelEvery === 0 || index === points.length - 1) && (index === points.length - 1 || points.length - 1 - index >= labelEvery) && (
					<span key={point.label} className={`absolute text-xs tabular-nums ${muted} ${index === 0 ? "" : index === points.length - 1 ? "-translate-x-full" : "-translate-x-1/2"}`} style={{ left: `${x(index)}%` }}>{point.label}</span>
				))}
			</div>
		</div>
	);
}

type Rect = { x: number; y: number; w: number; h: number };

/** Squarified treemap layout on a 100×100 box; rows are laid out in the order given. */
function squarify(values: number[], box: Rect): Rect[] {
	const total = values.reduce((sum, value) => sum + value, 0);
	if (total <= 0 || values.length === 0) return values.map(() => ({ x: box.x, y: box.y, w: 0, h: 0 }));
	const scale = (box.w * box.h) / total;
	const out: Rect[] = [];
	let { x, y, w, h } = box;
	let index = 0;
	while (index < values.length) {
		const horizontal = w >= h;
		const side = horizontal ? h : w;
		let run = 0;
		let count = 0;
		let worst = Infinity;
		for (let next = index; next < values.length; next += 1) {
			const area = values[next]! * scale;
			const candidate = run + area;
			const thickness = candidate / side;
			const ratio = Math.max(...values.slice(index, next + 1).map((value) => { const cell = value * scale; const length = cell / thickness; return Math.max(thickness / length, length / thickness); }));
			if (ratio > worst && count > 0) break;
			worst = ratio;
			run = candidate;
			count += 1;
		}
		const thickness = run / side;
		let offset = 0;
		for (let cell = index; cell < index + count; cell += 1) {
			const length = (values[cell]! * scale) / thickness;
			out.push(horizontal ? { x, y: y + offset, w: thickness, h: length } : { x: x + offset, y, w: length, h: thickness });
			offset += length;
		}
		if (horizontal) { x += thickness; w -= thickness; } else { y += thickness; h -= thickness; }
		index += count;
	}
	return out;
}

/** Part-to-whole as a treemap in the accent ramp, largest darkest, each cell with its own readable text colour and a 2px gap to its neighbours. The cell on show lifts above the rest instead of wearing an outline. */
function Treemap({ rows, total, toneOf, link }: { rows: Row[]; total: number; toneOf: (index: number) => Tone; link: Linkage }) {
	const reduce = useReducedMotion();
	const rects = squarify(rows.map((row) => row.count), { x: 0, y: 0, w: 100, h: 100 });
	return (
		<div className="relative h-full w-full" onPointerLeave={() => link.onPreview(null)}>
			{rows.map((row, index) => {
				const rect = rects[index]!;
				const current = index === link.shown;
				return (
					<motion.div key={row.name} className={`absolute ${current ? "z-10" : ""}`} style={{ left: `${rect.x}%`, top: `${rect.y}%`, width: `${rect.w}%`, height: `${rect.h}%` }} initial={reduce ? false : { opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ ...spring, delay: index * 0.04 }}>
						<button type="button" aria-pressed={current} aria-label={`${row.name}: ${number.format(row.count)}, ${percent(row.count, total)}%`} onPointerEnter={() => link.onPreview(index)} onFocus={() => link.onPreview(index)} onBlur={() => link.onPreview(null)} onClick={() => link.onSelect(index)} className={`absolute flex flex-col justify-end overflow-hidden rounded-xl p-3 text-left outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-[rgb(var(--ink-rgb))] focus-visible:ring-offset-2 focus-visible:ring-offset-transparent motion-reduce:transition-none ${toneClass} ${current ? "-inset-0.5 shadow-[0_8px_24px_rgb(0_0_0/0.2)]" : `inset-px ${link.previewing ? "opacity-50" : ""}`}`} style={toneStyle(toneOf(index))}>
							{rect.w > 12 && rect.h > 16 && <span className={`min-w-0 flex-col ${rect.w > 28 ? "flex" : "hidden sm:flex"}`}><span className="truncate text-sm font-semibold">{row.name}</span><span className="font-heading text-2xl font-semibold leading-none tabular-nums">{number.format(row.count)}<span className="ml-1.5 text-sm font-normal opacity-75">{percent(row.count, total)}%</span></span></span>}
						</button>
					</motion.div>
				);
			})}
		</div>
	);
}

/** The list beside every chart: swatch, name, share and count. Hovering previews a row in the chart, clicking keeps it. */
function Ranked({ rows, total, toneOf, link }: { rows: Row[]; total?: number; toneOf?: (index: number) => Tone; link: Linkage }) {
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
						<span className="min-w-0 flex-1 truncate text-base font-medium" title={row.name}>{row.name}</span>
						{total ? <span className={`text-sm tabular-nums ${muted}`}>{percent(row.count, total)}%</span> : null}
						<span className="w-12 shrink-0 text-right text-lg font-bold tabular-nums">{number.format(row.count)}</span>
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
function PublicationList({ items, className = "" }: { items: ListItem[]; className?: string }) {
	// The cards change with every row and tab the explorer shows, so their entrance is a CSS animation on mount, which
	// always ends visible; the band around them already rises into view as a whole.
	return <ul className={`flex flex-col gap-4 md:grid md:grid-cols-2 ${className}`}>{items.map((item, index) => <li key={item.key} className="animate-hero-rise rounded-xl motion-reduce:animate-none dark:bg-background" style={{ animationDelay: `${index * 90}ms` }}><Resource as="div" itemData={item} abstract={false} className="h-full" hideUnapi /></li>)}</ul>;
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
	const [selected, setSelected] = useState(view.initial ?? 0);
	const [preview, setPreview] = useState<number | null>(null);
	const shown = preview ?? selected;
	const row = view.rows[shown]!;
	const link: Linkage = { shown, previewing: preview !== null, onPreview: setPreview, onSelect: setSelected };
	// The row's own newest publications, the first of what "See all" opens; the last row's stay up while the next loads.
	const { data: examples } = useSWR<ItemsGetResponse>(row.filter ? `/items?${row.filter}&sort=desc&limit=2` : null, fetcher, { keepPreviousData: true });
	return (
		<>
			<div className={`rounded-2xl p-5 lg:p-8 ${toneClass}`} style={toneStyle(surface)}>
			<Reading className="min-h-[4.6em] text-2xl leading-[1.15] sm:min-h-[2.3em] lg:text-[28px]">{view.reading(row, shown)}</Reading>
			<div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,8fr)_minmax(0,4fr)] lg:gap-12">
				<div className="flex h-[20rem] min-w-0 items-center lg:h-[24rem]">{view.chart(link)}</div>
				<div className="h-[16rem] min-w-0 lg:h-[24rem]"><Ranked rows={view.rows} total={view.total} toneOf={view.toneOf} link={link} /></div>
			</div>
				<p className={`mt-8 pt-4 text-sm ${rule} ${muted}`}>Counted from the library on {dateFormat.format(data.updated)}.</p>
			</div>
			{row.filter && (
				<div className="mt-8">
					<div className="mb-4 flex items-baseline justify-between gap-6">
						<h3 className="flex min-w-0 items-center gap-2 text-xl font-medium">{row.flag && <CountryFlag countryCode={row.flag} className="h-3.5 w-5 shrink-0 rounded-[3px]" />}<span className="truncate" title={row.name}>{row.name}</span></h3>
						<div className="shrink-0 whitespace-nowrap text-sm"><TextLink href={`/lib?${row.filter}`}>See all {number.format(examples?.totalItems ?? row.count)}</TextLink></div>
					</div>
					<PublicationList items={examples?.items ?? []} className="min-h-[27rem] md:min-h-[12rem] [&>li]:min-h-[13.5rem] md:[&>li]:min-h-[12rem]" />
				</div>
			)}
		</>
	);
}

function Facts({ data }: { data: HomeData }) {
	const of = (part: number) => `${number.format(part)} of ${number.format(data.publications)}`;
	// A fact whose figure is zero says the library has no such data yet, not something about its publications.
	const facts = [
		data.attachments?.itemsWith && { icon: Pdf01Icon, value: `${percent(data.attachments.itemsWith, data.publications)}%`, label: "have the PDF attached", detail: of(data.attachments.itemsWith) },
		data.citations?.itemsWith && { icon: QuoteUpIcon, value: `${percent(data.citations.itemsWith, data.publications)}%`, label: "are cited by another publication", detail: of(data.citations.itemsWith) },
		data.collaboration?.collaborative && { icon: Globe02Icon, value: `${percent(data.collaboration.collaborative, data.publications)}%`, label: "are international collaborations", detail: of(data.collaboration.collaborative) },
		data.citations?.total && { icon: Analytics01Icon, value: number.format(data.citations.total), label: "citations in total", detail: `${number.format(data.citations.average)} per publication` },
		data.citations?.hIndex && { icon: Layers01Icon, value: number.format(data.citations.hIndex), label: "h-index of the library", detail: `most cited has ${number.format(data.citations.max)}` },
		data.productivity?.multiple && { icon: UserMultipleIcon, value: number.format(data.productivity.multiple), label: "authors with several publications", detail: `${number.format(data.productivity.average)} per author` },
	].filter((fact): fact is { icon: IconSvgElement; value: string; label: string; detail: string } => Boolean(fact));
	if (facts.length === 0) return null;
	return (
		<motion.dl {...listMotion} className={`mt-14 grid grid-cols-2 gap-x-8 gap-y-10 pt-12 sm:grid-cols-3 lg:grid-cols-6 ${rule}`}>
			{facts.map((fact) => (
				<motion.div key={fact.label} variants={arrive} className="flex flex-col-reverse justify-end gap-2">
					<dt><span className="flex items-start gap-1.5 text-sm font-medium leading-snug"><HugeiconsIcon icon={fact.icon} aria-hidden size={16} className="mt-0.5 shrink-0" />{fact.label}</span><span className={`mt-1 block text-xs ${muted}`}>{fact.detail}</span></dt>
					<dd className="font-heading text-4xl font-semibold leading-none tracking-tight tabular-nums"><CountUp text={fact.value} /></dd>
				</motion.div>
			))}
		</motion.dl>
	);
}


/** Everything the explorer band shows: one tab strip over every measure, the linked panel and the facts row. */
function Explorer({ data, shapes, tones, ramp }: { data: HomeData; shapes: MapShape[]; tones: Tones; ramp: Tone[] }) {
	const [tab, setTab] = useState<string | null>(null);
	const { filters, search } = useLibraryConfig();
	/** The listing's query for one of its filters, or nothing where the library has that filter switched off. */
	const listing = (on: boolean, params: { collections?: string[]; country?: string[]; institution?: string[]; range?: string }) => (on ? serializeSearchParams(params).slice(1) : undefined);
	const collectionKeys = new Map(data.collections.map((collection) => [collection.title, collection.key]));
	const countries = Object.keys(data.countries).length;
	const series = yearSeries(data);
	const peak = series.reduce((best, point, index) => (point.value > (series[best]?.value ?? -1) ? index : best), 0);

	const types = [...data.itemTypes].sort((a, b) => b.count - a.count).slice(0, 6).map((row) => ({ name: humanType(row.itemType).replace(/^./, (first) => first.toUpperCase()), count: row.count }));
	const otherTypes = data.publications - types.reduce((sum, row) => sum + row.count, 0);

	const rampOf = (rows: Row[]) => (index: number) => ramp[Math.round((index * (ramp.length - 1)) / Math.max(1, rows.length - 1))]!;
	/** A part-to-whole view: treemap in the ramp, shares counted against the library unless the rows are a top list. */
	const parts = (view: Pick<View, "key" | "title" | "icon" | "reading">, rows: Row[], total?: number): View => ({ ...view, rows, total, toneOf: rampOf(rows), chart: (link) => <Treemap rows={rows} total={total ?? rows.reduce((sum, row) => sum + row.count, 0)} toneOf={rampOf(rows)} link={link} /> });
	const counted = (row: Row) => <strong>{number.format(row.count)}</strong>;

	const countryRows: Row[] = Object.entries(data.countries).sort((a, b) => b[1] - a[1]).map(([code, count]) => ({ name: regionNames.of(code) ?? code, count, flag: code, filter: listing(search.country && Boolean(data.countryPaths[code]), { country: [data.countryPaths[code]!] }) }));
	const yearRows: Row[] = series.map((point) => ({ name: point.label, count: point.value, filter: listing(filters.years.enabled, { range: point.label }) })).reverse();
	const flip = (index: number) => series.length - 1 - index;
	const allViews: View[] = [
		{ key: "years", title: "By year", icon: Calendar03Icon, rows: yearRows, initial: flip(peak), reading: (row, index) => (index === flip(peak) ? <><strong>{row.name}</strong> was the busiest year, with <strong>{number.format(row.count)}</strong> publications</> : <>{counted(row)} {row.count === 1 ? "publication is" : "publications are"} from <strong>{row.name}</strong></>), chart: (link) => <div className="h-full w-full"><Trend points={series} link={{ ...link, shown: flip(link.shown), onPreview: (index) => link.onPreview(index === null ? null : flip(index)), onSelect: (index) => link.onSelect(flip(index)) }} unit="year" labelEvery={series.length > 14 ? 3 : series.length > 8 ? 2 : 1} dottedLast /></div> },
		parts({ key: "types", title: "By type", icon: Layers01Icon, reading: (row) => (row.name === "Other" ? <>{counted(row)} publications are of <strong>another type</strong></> : <><strong>{percent(row.count, data.publications)}%</strong> are <strong>{plural(row.name)}</strong></>) }, otherTypes > 0 ? [...types, { name: "Other", count: otherTypes }] : types, data.publications),
		{ key: "countries", title: "By country", icon: Globe02Icon, rows: countryRows, reading: (row, index) => (index === 0 ? <><strong>{row.name}</strong> leads {countries} countries, with {counted(row)} publications</> : <>{counted(row)} {row.count === 1 ? "publication is" : "publications are"} about <strong>{row.name}</strong></>), chart: (link) => <HomeMap shapes={shapes} countries={data.countries} bubbles className="w-full text-accent" active={countryRows[link.shown]?.flag} dim={link.previewing} onHover={(code) => link.onPreview(code ? countryRows.findIndex((row) => row.flag === code) : null)} onSelect={(code) => link.onSelect(countryRows.findIndex((row) => row.flag === code))} /> },
		parts({ key: "collections", title: "Collections", icon: Folder01Icon, reading: (row) => <><strong>{row.name}</strong> holds {counted(row)} publications, {percent(row.count, data.publications)}% of the library</> }, data.collections.map((collection) => ({ name: collection.title, count: collection.count, filter: listing(true, { collections: [collection.key] }) })), data.publications),
		parts({ key: "topics", title: "Topics", icon: Tag01Icon, reading: (row) => <>{counted(row)} publications are about <strong>{row.name.toLowerCase()}</strong></> }, data.topics.map((row) => ({ ...row, filter: listing(collectionKeys.has(row.name), { collections: [collectionKeys.get(row.name)!] }) }))),
		parts({ key: "languages", title: "Languages", icon: LanguageSkillIcon, reading: (row) => <><strong>{percent(row.count, data.publications)}%</strong> are written in <strong>{row.name}</strong></> }, data.languages, data.publications),
		parts({ key: "institutions", title: "Institutions", icon: UniversityIcon, reading: (row) => <>{counted(row)} publications have an author at <strong>{row.name}</strong></> }, data.institutions.map((row) => ({ ...row, filter: listing(filters.institution.mode !== "hidden", { institution: [row.name] }) }))),
		parts({ key: "publishers", title: "Publishers", icon: Building03Icon, reading: (row) => <><strong>{row.name}</strong> published {counted(row)} of them</> }, data.publishers),
		parts({ key: "journals", title: "Journals", icon: Book02Icon, reading: (row) => <>{counted(row)} appeared in <strong>{row.name}</strong></> }, data.journals),
	];
	const views = allViews.filter((item) => item.rows.some((row) => row.count > 0));
	const view = views.find((item) => item.key === tab) ?? views[0];

	return (
		<>
			{/* The tab strip only. NextUI mounts its own panel after hydration, which made the explorer pop in late and push the page down; the panel below is ours, so it is in the server HTML. */}
			<Tabs aria-label="Explore the data" color="card" size="lg" selectedKey={view?.key} onSelectionChange={(key) => setTab(String(key))} classNames={{ base: "max-w-full", tabList: "max-w-full overflow-x-auto", tab: "w-auto flex-none md:px-5", panel: "hidden" }}>
				{views.map((item) => <Tab key={item.key} title={<span className="flex items-center gap-2"><HugeiconsIcon icon={item.icon} aria-hidden size={16} />{item.title}</span>} />)}
			</Tabs>
			{view && <div role="tabpanel" aria-label={view.title} className="pt-4"><ExplorerPanel key={view.key} view={view} data={data} surface={tones.card} /></div>}
			<Facts data={data} />
		</>
	);
}

/** Years as a continuous series, so a year without publications still has its place on the axis. */
function yearSeries(data: HomeData) {
	const counts = new Map(data.years.map((row) => [row.year, row.count]));
	if (!counts.size) return [];
	const firstYear = Math.min(...counts.keys());
	return Array.from({ length: Math.max(...counts.keys()) - firstYear + 1 }, (_, index) => ({ label: String(firstYear + index), value: counts.get(firstYear + index) ?? 0 }));
}


/** Renders `children` with the library's figures once they arrive; until then its own box holds the space. */
function WithData({ data, children }: { data: Promise<HomeData>; children: (data: HomeData) => React.ReactNode }) {
	return <>{children(use(data))}</>;
}

type Props = { name: string; siteUrl: string; contactEmail: string | null; about: HomeContent; data: Promise<HomeData>; tones: Tones; ramp: Tone[]; shapes: MapShape[] };

/**
 * Everything the library wrote and the page's structure render at once; the parts built from the library's figures
 * stream in behind their own boundaries as the data arrives, each in a box that already has its final size.
 */
export default function HomePage({ name, siteUrl, contactEmail, about, data, tones, ramp, shapes }: Props) {
	const t = useTranslations("homePage");
	const reduce = useReducedMotion();
	// A library that uploaded its own logo leads its hero with it; the platform's stand-in logo is left in the bar.
	const { identity, notifications } = useLibraryConfig();
	const ownLogo = hasOwnLogo(identity.assets);
	// The digest button offers a subscription, so it goes when the library sends no digests.
	const digestsOn = notifications.enabled;
	// The map behind the hero drifts at a fraction of the scroll, so the page reads as layered.
	const { scrollY } = useScroll();
	const drift = useTransform(scrollY, [0, 900], [0, reduce ? 0 : -120]);
	const heading = (key: keyof NonNullable<HomeContent["headings"]>) => about.headings?.[key]?.trim() || t(key);
	// Each answered question gets a band of its own, in the order the page reads; a blank one drops out and the seams close up.
	const bands = [
		{
			key: "inside",
			tone: tones.card,
			body: (
				<Suspense fallback={<div className="h-[220rem] lg:h-[124.3rem]" />}>
					<WithData data={data}>{(figures) => <Inside data={figures} surface={tones.tertiary} questions={about.questions} />}</WithData>
				</Suspense>
			),
		},
		{
			key: "explore",
			tone: tones.tint,
			body: (
				<>
					<Heading>Explore the data</Heading>
					<Suspense fallback={<div className="h-[120rem] lg:h-[71rem]" />}>
						<WithData data={data}>{(figures) => <Explorer data={figures} shapes={shapes} tones={tones} ramp={ramp} />}</WithData>
					</Suspense>
				</>
			),
		},
		(about.curation?.text || about.curation?.steps?.length) && { key: "curation", tone: tones.deep, body: <Curation curation={about.curation!} heading={heading("curation")} data={data} /> },
		// Every library can be cited, so this band is always there; the admin's "anything else" answer sits beside the slip.
		{
			key: "cite",
			tone: tones.card,
			body: (
				<>
					<Heading>{about.extra?.title?.trim() || "Cite the library"}</Heading>
					<div className={about.extra?.text.trim() ? twoColumns : ""}>
						{about.extra?.text.trim() && <div className="max-w-[40rem]"><RichText text={about.extra.text} /></div>}
						<CiteSlip name={name} url={siteUrl} />
					</div>
				</>
			),
		},
		(about.team || about.editors?.length || about.involvement?.suggestions || about.involvement?.editors) && { key: "team", tone: tones.tertiary, body: <Team team={about.team} editors={about.editors} involvement={about.involvement} contactEmail={contactEmail} heading={heading} /> },
	].filter((band): band is { key: string; tone: Tone; body: React.JSX.Element } => Boolean(band));

	return (
		<MotionConfig reducedMotion="user">
			<PageContainer className="flex flex-col py-0 lg:py-0 xl:py-0">
				<section className={`relative isolate pb-16 pt-10 lg:pb-24 lg:pt-16 ${toneClass}`} style={toneStyle(tones.page)}>
					<div aria-hidden className={`pointer-events-none absolute inset-y-0 left-1/2 -z-10 w-screen -translate-x-1/2 overflow-hidden ${toneClass}`}>
						{/* The map fills the hero and drifts up as the page scrolls, so its southern coasts are never pushed out of view. */}
						<motion.div className="absolute inset-0" style={{ y: drift }}>
							<Suspense fallback={<HomeMap shapes={shapes} countries={{}} cover className="absolute inset-0 text-accent opacity-40" />}>
								<WithData data={data}>{(figures) => <HomeMap shapes={shapes} countries={figures.countries} cover className="absolute inset-0 text-accent opacity-40" />}</WithData>
							</Suspense>
						</motion.div>
						<Suspense fallback={null}><WithData data={data}>{(figures) => <HeroRow data={figures} />}</WithData></Suspense>
						{/* A wash of the page colour behind the text, so the map shows only faintly where people read; it fades out before the covers. */}
						<div className="absolute inset-0 bg-[linear-gradient(to_right,var(--band-bg)_0%,var(--band-bg)_22%,transparent_62%)] dark:bg-[linear-gradient(to_right,var(--band-bg-dark)_0%,var(--band-bg-dark)_22%,transparent_62%)] opacity-90 max-xl:bg-[linear-gradient(to_bottom,transparent_0%,transparent_10rem,var(--band-bg)_14rem)] max-xl:dark:bg-[linear-gradient(to_bottom,transparent_0%,transparent_10rem,var(--band-bg-dark)_14rem)] sm:max-xl:bg-[linear-gradient(to_bottom,transparent_0%,transparent_18rem,var(--band-bg)_21rem)] sm:max-xl:dark:bg-[linear-gradient(to_bottom,transparent_0%,transparent_18rem,var(--band-bg-dark)_21rem)]" />
					</div>
					<Suspense fallback={null}><WithData data={data}>{(figures) => <HeroShelf data={figures} />}</WithData></Suspense>
				{/* Name and tagline read as one unit; the intro is supporting text, set apart and softer; then the actions. */}
				<div className="relative flex min-h-[26rem] flex-col items-start justify-end pt-44 sm:pt-60 lg:min-h-[32rem] xl:pt-36">
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
						{about.intro && <div className="mt-8 max-w-[34rem] animate-hero-rise text-[17px] leading-7 text-[rgb(var(--ink-rgb)/0.75)] [animation-delay:140ms] motion-reduce:animate-none [&_p]:mb-0 [&_p]:max-w-none [&_p]:text-[length:inherit] [&_p]:leading-[inherit] [&_p]:opacity-100 [&_strong]:text-[rgb(var(--ink-rgb))]"><RichText text={about.intro} /></div>}
						<div className="mt-10 flex animate-hero-rise flex-wrap gap-3 [animation-delay:180ms] motion-reduce:animate-none">
							<Button as={Link} href="/lib" color="accent" variant="solid" size="md" startContent={<HugeiconsIcon icon={Search01Icon} aria-hidden size={18} />}>Explore the library</Button>
							{digestsOn ? <Button as={Link} href="/digests" variant="muted" size="md" startContent={<HugeiconsIcon icon={Notification03Icon} aria-hidden size={18} />}>Get the digest</Button> : null}
						</div>
					</div>
				</section>

				{bands.map((band, index) => <Band key={band.key} tone={band.tone} previous={bands[index - 1]?.tone ?? tones.page} inverse={band.tone === tones.deep || band.tone === tones.tertiary}>{band.body}</Band>)}

				<FooterSeam previous={bands.at(-1)?.tone ?? tones.card} />
			</PageContainer>
		</MotionConfig>
	);
}
