"use client";

import { createContext, ReactNode, use, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { useLocalStorage } from "usehooks-ts";
import { Popover, PopoverContent, PopoverTrigger, Spinner } from "@nextui-org/react";
import { MdTranslate } from "react-icons/md";
import { IoArrowUndo, IoCheckmark, IoCheckmarkCircle, IoChevronBack, IoChevronForward, IoSearch } from "react-icons/io5";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";
import { Switch } from "@/components/nextui/Switch";
import { abstractIn, saveAbstracts, saveTitles, titleIn, useTranslationStore, type TranslationStore } from "./translation-store";

/** Languages results can be translated into: the world's most spoken, and the languages of the regions the libraries cover. */
const TRANSLATION_LANGUAGE_CODES = [
	"af", "ak", "am", "ar", "bn", "cs", "da", "de", "el", "en", "es", "fa", "ff", "fi", "fil", "fr", "gu", "ha", "he",
	"hi", "hu", "id", "ig", "it", "ja", "km", "kn", "ko", "lg", "ln", "mg", "ml", "mr", "ms", "my", "ne", "nl", "no",
	"ny", "om", "pa", "pl", "ps", "pt", "rn", "ro", "ru", "rw", "si", "sn", "so", "st", "sv", "sw", "ta", "te", "th",
	"ti", "tn", "tr", "uk", "ur", "vi", "wo", "xh", "yo", "zh", "zu",
] as const;

const LOCALE_LANGUAGE: Record<string, string> = { "en-GB": "en", "en-US": "en", cn: "zh" };
const CURRENT_LOCALE = "locale";

const capitalise = (name: string, code: string) => name.charAt(0).toLocaleUpperCase(code) + name.slice(1);

/** The language in itself (Kiswahili) and in the page's language (Swahili). */
function languageNames(code: string, pageLocale: string) {
	const own = new Intl.DisplayNames([code], { type: "language" }).of(code) ?? code;
	const inPage = new Intl.DisplayNames([pageLocale === "cn" ? "zh" : pageLocale], { type: "language" }).of(code) ?? code;
	return { code, own: capitalise(own, code), inPage: capitalise(inPage, pageLocale) };
}

/** A language code's name in the page's language; the code itself when the model sent one Intl doesn't know. */
function languageName(code: string, pageLocale: string) {
	try {
		return new Intl.DisplayNames([pageLocale === "cn" ? "zh" : pageLocale], { type: "language" }).of(code) ?? code;
	} catch {
		return code;
	}
}

const fold = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

type ResultsTranslation = {
	/** "results" for a list, "record" for one record's own page. */
	scope: "results" | "record";
	target: string;
	choice: string;
	setChoice: (choice: string) => void;
	auto: boolean;
	setAuto: (auto: boolean) => void;
	/** This browser's stored translations; null through hydration. */
	store: TranslationStore | null;
	/** Records whose title or abstract is being translated right now. */
	titlesPending: boolean;
	abstractsPending: Set<string>;
	isTranslating: boolean;
	/** Every listed record has its title stored in the target language. */
	allTranslated: boolean;
	listedCount: number;
	active: boolean;
	run: () => void;
	undo: () => void;
	originals: Set<string>;
	toggleOriginal: (key: string) => void;
};

const ResultsTranslationContext = createContext<ResultsTranslation | null>(null);

/** Abstracts go in batches this size, side by side, so a page takes about as long as its slowest five. */
const ABSTRACT_BATCH = 5;

type Listed = { key: string; title: string; abstract: string };

async function translatePart([, part, target, items]: [string, "titles" | "abstracts", string, unknown[]]) {
	const response = await fetch("/api/mock-translate", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ part, target, items }),
	});
	if (!response.ok) throw new Error(await response.text());
	const translated = (await response.json())[part];
	if (part === "titles") saveTitles(target, translated);
	else saveAbstracts(target, translated);
	return translated;
}

const swrOptions = { revalidateOnFocus: false, revalidateOnReconnect: false, keepPreviousData: false };

/** One batch of abstracts, asking only for those this browser hasn't stored yet. */
function useAbstractBatch(active: boolean, store: TranslationStore | null, target: string, batch: Listed[]) {
	const missing = store ? batch.filter(({ key }) => abstractIn(store, target, key) === undefined) : [];
	const query = useSWR(
		active && missing.length > 0
			? ["mock-translate", "abstracts", target, missing.map(({ key, abstract }) => ({ key, abstract }))]
			: null,
		translatePart,
		swrOptions,
	);
	return { keys: missing.map(({ key }) => key), isLoading: active && query.isLoading };
}

const plain = (markup: string | undefined) => (markup ?? "").replace(/<[^>]+>/g, "");

type Translatable = { key: string; title?: string | null; abstractNote?: string | null };

/** Settings and stored translations are the browser's, so results and item pages share them. */
export function ResultsTranslationProvider({
	items,
	scope = "results",
	children,
}: {
	items: Translatable[] | undefined;
	scope?: "results" | "record";
	children: ReactNode;
}) {
	const locale = useLocale();
	const localeLanguage = LOCALE_LANGUAGE[locale] ?? locale;
	const store = useTranslationStore();
	const [choice, setChoice] = useLocalStorage("results-translation-language", CURRENT_LOCALE);
	const [auto, setAutoStored] = useLocalStorage("results-translation-auto", false);
	const [ranFor, setRanFor] = useState<string | null>(null);
	const [originals, setOriginals] = useState<Set<string>>(new Set());
	const target = choice === CURRENT_LOCALE ? localeLanguage : choice;

	const listed = useMemo(
		() =>
			(items ?? []).map((item) => ({
				key: item.key,
				title: plain(item.title ?? undefined),
				abstract: plain(item.abstractNote ?? undefined),
			})),
		[items],
	);
	const signature = `${target}:${listed.map(({ key }) => key).join(",")}`;
	const active = store !== null && listed.length > 0 && (auto || ranFor === signature);

	const missingTitles = store ? listed.filter(({ key }) => titleIn(store, target, key) === undefined) : [];
	const titlesQuery = useSWR(
		active && missingTitles.length > 0
			? ["mock-translate", "titles", target, missingTitles.map(({ key, title }) => ({ key, title }))]
			: null,
		translatePart,
		swrOptions,
	);
	// A results page holds 20 records: four batches of five, one hook each, fixed by the list's order.
	const withAbstracts = listed.filter(({ abstract }) => abstract);
	const batches = [0, 1, 2, 3].map((i) => withAbstracts.slice(i * ABSTRACT_BATCH, (i + 1) * ABSTRACT_BATCH));
	const batchQueries = [
		useAbstractBatch(active, store, target, batches[0]),
		useAbstractBatch(active, store, target, batches[1]),
		useAbstractBatch(active, store, target, batches[2]),
		useAbstractBatch(active, store, target, batches[3]),
	];
	const abstractsPending = new Set(batchQueries.flatMap(({ keys, isLoading }) => (isLoading ? keys : [])));
	const titlesPending = active && titlesQuery.isLoading;
	const isTranslating = titlesPending || abstractsPending.size > 0;

	const value: ResultsTranslation = {
		scope,
		target,
		choice,
		setChoice: (next) => {
			setChoice(next);
			setOriginals(new Set());
		},
		auto,
		setAuto: (next) => {
			setAutoStored(next);
			if (!next) setRanFor(null);
			setOriginals(new Set());
		},
		store,
		titlesPending,
		abstractsPending,
		isTranslating,
		allTranslated: active && !isTranslating && missingTitles.length === 0,
		listedCount: listed.length,
		active,
		run: () => {
			setRanFor(signature);
			setOriginals(new Set());
		},
		// Off as well, or the next page would translate itself straight away.
		undo: () => {
			setAutoStored(false);
			setRanFor(null);
		},
		originals,
		toggleOriginal: (key) =>
			setOriginals((previous) => {
				const next = new Set(previous);
				if (next.has(key)) next.delete(key);
				else next.add(key);
				return next;
			}),
	};

	return <ResultsTranslationContext.Provider value={value}>{children}</ResultsTranslationContext.Provider>;
}

/** The record's text in the chosen language while translation is on, part by part as each arrives; null when it needs none. */
export function useItemTranslation(key: string | undefined) {
	const context = use(ResultsTranslationContext);
	const locale = useLocale();
	if (!context || !key || !context.active) return null;
	const title = titleIn(context.store, context.target, key);
	if (!title) return context.titlesPending ? { pending: true as const } : null;
	if (title.same) return null;
	return {
		pending: false as const,
		title: title.title,
		abstract: abstractIn(context.store, context.target, key),
		abstractPending: context.abstractsPending.has(key),
		sourceName: languageName(title.source, locale),
		showingOriginal: context.originals.has(key),
		toggle: () => context.toggleOriginal(key),
	};
}

/** Follows its content's height, so the frame animates when the popover switches views. */
function AnimatedHeight({ children }: { children: ReactNode }) {
	const inner = useRef<HTMLDivElement>(null);
	const [height, setHeight] = useState<number>();
	// ResizeObserver: the content's own size, which the frame animates to.
	useEffect(() => {
		const element = inner.current;
		if (!element) return;
		const observer = new ResizeObserver(([entry]) => setHeight(entry.borderBoxSize[0].blockSize));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return (
		<div className="overflow-hidden transition-[height] duration-200 ease-out motion-reduce:transition-none" style={{ height }}>
			<div ref={inner}>{children}</div>
		</div>
	);
}

export function ResultsTranslationControl() {
	const context = use(ResultsTranslationContext);
	const t = useTranslations("translation");
	const locale = useLocale();
	const [isOpen, setIsOpen] = useState(false);
	const [view, setView] = useState<"main" | "languages">("main");
	const [query, setQuery] = useState("");
	const languages = useMemo(
		() =>
			TRANSLATION_LANGUAGE_CODES.map((code) => languageNames(code, locale)).sort((a, b) =>
				a.inPage.localeCompare(b.inPage, locale === "cn" ? "zh" : locale),
			),
		[locale],
	);
	if (!context) return null;

	const { target, choice, auto, isTranslating, allTranslated, listedCount, scope } = context;
	const record = scope === "record";
	const pageLanguage = languageNames(LOCALE_LANGUAGE[locale] ?? locale, locale);
	const targetLanguage = languageNames(target, locale);
	const done = allTranslated;
	const matches = languages.filter(({ code, own, inPage }) =>
		[code, own, inPage].some((name) => fold(name).includes(fold(query.trim()))),
	);
	const choose = (next: string) => {
		context.setChoice(next);
		setView("main");
		setQuery("");
	};

	const row = "flex w-full items-center gap-3 px-4 text-start";

	return (
		<Popover
			placement="bottom-end"
			isOpen={isOpen}
			onOpenChange={(open) => {
				setIsOpen(open);
				if (!open) {
					setView("main");
					setQuery("");
				}
			}}
			offset={8}
		>
			<PopoverTrigger>
				<Button
					aria-label={t("buttonLabel", { language: targetLanguage.inPage })}
					size={record ? "sm" : undefined}
					className={twMerge(
						record ? "shrink-0" : "h-full shrink-0 gap-2 px-4 xl:px-4",
						done && "border-accent text-accent dark:text-accent",
						isOpen && "outline outline-2 outline-focus",
					)}
					startContent={
						isTranslating ? (
							<Spinner size="sm" color="current" classNames={{ wrapper: record ? "size-4" : "size-5" }} />
						) : done ? (
							<IoCheckmarkCircle className={twMerge("shrink-0", record ? "size-4" : "size-5")} />
						) : (
							<MdTranslate className={twMerge("shrink-0", record ? "size-4" : "size-5")} />
						)
					}
				>
					{/* Both labels share one cell so the button keeps the longer one's width when it switches. */}
					<span className={twMerge("justify-items-start", record ? "inline-grid" : "hidden xl:inline-grid")}>
						<span className={twMerge("col-start-1 row-start-1", done && "invisible")}>{t("translate")}</span>
						<span className={twMerge("col-start-1 row-start-1", !done && "invisible")}>{t("translated")}</span>
					</span>
					<span className="rounded-md bg-black/[6%] px-1.5 py-0.5 text-xs font-semibold tabular-nums dark:bg-white/10">
						{target.toUpperCase()}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-[22rem] rounded-2xl border-small border-black/10 bg-white p-0 dark:border-white/10 dark:bg-secondary">
				<div className="w-full">
					<AnimatedHeight>
						{view === "main" ? (
							<div className="flex flex-col gap-5 p-5">
								<p className="text-lg font-semibold text-black/80 dark:text-white/90">{record ? t("titleRecord") : t("title")}</p>

								<div className="divide-y divide-black/[8%] overflow-hidden rounded-xl border-small border-black/[8%] dark:divide-white/10 dark:border-white/10">
									<button
										type="button"
										onClick={() => setView("languages")}
										className={twMerge(row, "h-16 transition-colors hover:bg-black/[3%] dark:hover:bg-white/[4%]")}
									>
										<span className="flex-1 text-sm font-medium text-black/80 dark:text-white/80">{t("into")}</span>
										<span className="flex min-w-0 flex-col items-end">
											<span className="truncate text-sm font-semibold text-black/80 dark:text-white/90">
												{targetLanguage.own}
											</span>
											<span className="truncate text-xs text-black/50 dark:text-white/50">
												{choice === CURRENT_LOCALE ? t("currentLocale") : targetLanguage.inPage}
											</span>
										</span>
										<IoChevronForward className="size-4 shrink-0 text-black/30 rtl:-scale-x-100 dark:text-white/30" />
									</button>
									<label className={twMerge(row, "h-16 cursor-pointer")}>
										<span className="flex min-w-0 flex-1 flex-col">
											<span className="text-sm font-medium text-black/80 dark:text-white/80">{t("auto")}</span>
											<span className="truncate text-xs text-black/50 dark:text-white/50">{t("autoHint")}</span>
										</span>
										<Switch size="sm" isSelected={auto} onValueChange={context.setAuto} classNames={{ base: "m-0 shrink-0" }} />
									</label>
								</div>

								<Button
									color={done ? "secondary" : "accent"}
									className="h-11 w-full rounded-xl font-medium"
									isDisabled={isTranslating || listedCount === 0}
									startContent={
										isTranslating ? (
											<Spinner size="sm" color="current" classNames={{ wrapper: "size-4" }} />
										) : done ? (
											<IoArrowUndo className="size-4 shrink-0" />
										) : (
											<MdTranslate className="size-4 shrink-0" />
										)
									}
									onPress={done ? context.undo : context.run}
								>
									{isTranslating
										? record
											? t("translatingRecord")
											: t("translating", { count: listedCount })
										: done
											? record
												? t("showOriginal")
												: t("showOriginals")
											: record
												? t("runRecord")
												: t("run", { count: listedCount })}
								</Button>
							</div>
						) : (
							<div className="flex flex-col">
								<div className="flex items-center gap-2 px-3 pb-2 pt-3">
									<button
										type="button"
										aria-label={t("back")}
										onClick={() => setView("main")}
										className="flex size-9 shrink-0 items-center justify-center rounded-lg text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10"
									>
										<IoChevronBack className="size-5 rtl:-scale-x-100" />
									</button>
									<p className="text-base font-semibold text-black/80 dark:text-white/90">{t("into")}</p>
								</div>
								<div className="px-4 pb-2">
									<label className="flex h-10 items-center gap-2 rounded-xl bg-black/[4%] px-3 dark:bg-white/[6%]">
										<IoSearch className="size-4 shrink-0 text-black/40 dark:text-white/40" />
										<input
											autoFocus
											value={query}
											onChange={(event) => setQuery(event.target.value)}
											placeholder={t("searchLanguages")}
											className="min-w-0 flex-1 bg-transparent text-sm text-black/80 outline-none placeholder:text-black/40 dark:text-white/80 dark:placeholder:text-white/40"
										/>
									</label>
								</div>
								<ul className="max-h-80 overflow-y-auto px-2 pb-2">
									{!query.trim() && (
										<li>
											<LanguageOption
												selected={choice === CURRENT_LOCALE}
												primary={t("currentLocale")}
												secondary={pageLanguage.own}
												onSelect={() => choose(CURRENT_LOCALE)}
											/>
										</li>
									)}
									{matches.map(({ code, own, inPage }) => (
										<li key={code}>
											<LanguageOption
												selected={choice === code}
												primary={own}
												secondary={own === inPage ? undefined : inPage}
												onSelect={() => choose(code)}
											/>
										</li>
									))}
									{matches.length === 0 && (
										<li className="flex h-11 items-center px-3 text-sm text-black/50 dark:text-white/50">{t("noLanguages")}</li>
									)}
								</ul>
							</div>
						)}
					</AnimatedHeight>
				</div>
			</PopoverContent>
		</Popover>
	);
}

function LanguageOption({
	selected,
	primary,
	secondary,
	onSelect,
}: {
	selected: boolean;
	primary: string;
	secondary?: string;
	onSelect: () => void;
}) {
	return (
		<button
			type="button"
			aria-pressed={selected}
			onClick={onSelect}
			className={twMerge(
				"flex h-11 w-full items-center gap-3 rounded-lg px-3 text-start transition-colors hover:bg-black/[4%] dark:hover:bg-white/[6%]",
				selected && "bg-black/[4%] dark:bg-white/[6%]",
			)}
		>
			<span className="truncate text-sm font-medium text-black/80 dark:text-white/90">{primary}</span>
			{secondary && <span className="truncate text-sm text-black/45 dark:text-white/45">{secondary}</span>}
			{selected && <IoCheckmark className="ms-auto size-4 shrink-0 text-accent" />}
		</button>
	);
}

/** On a translated record: which language it came from, and a switch back to the original. */
export function ItemTranslationToggle({ itemKey }: { itemKey: string | undefined }) {
	const translation = useItemTranslation(itemKey);
	const t = useTranslations("translation");
	if (!translation || translation.pending) return null;
	return (
		<button
			type="button"
			aria-pressed={!translation.showingOriginal}
			onClick={translation.toggle}
			className={twMerge(
				"ms-2 inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-medium transition-colors",
				translation.showingOriginal
					? "bg-black/5 text-black/60 hover:text-black/80 dark:bg-white/10 dark:text-white/70"
					: "bg-accent/10 text-accent hover:bg-accent/15 dark:bg-accent/20",
			)}
		>
			<MdTranslate className="size-3.5 shrink-0" />
			{translation.showingOriginal
				? t("showTranslation")
				: translation.sourceName
					? t("translatedFrom", { language: translation.sourceName })
					: t("translated")}
		</button>
	);
}
