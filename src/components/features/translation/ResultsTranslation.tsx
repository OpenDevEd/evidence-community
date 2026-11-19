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
import { useFeatureFlagEnabled } from "@/context/Providers";
import { getAnalyticsDistinctId } from "@/lib/analytics";
import {
	ABSTRACTS_PER_REQUEST,
	TRANSLATION_LANGUAGE_CODES,
	type RecordTranslation,
	type TranslationPart,
} from "@/lib/translation-languages";
import { zoteroMarkupToPlainText } from "@/lib/zoteroMarkup";
import {
	saveTranslations,
	setShown,
	shownKey,
	translationIn,
	useShown,
	useTranslationStore,
	type TranslationStore,
} from "./translation-store";

const LOCALE_LANGUAGE: Record<string, string> = { "en-GB": "en", "en-US": "en", cn: "zh" };
const CURRENT_LOCALE = "locale";
/** The settings start at their defaults on the first frame, as on the server, and read the browser's after it. */
const STORED_SETTING = { initializeWithValue: false } as const;

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
	/** The listed records' current text, which a stored translation must have been made from. */
	sources: ReadonlyMap<string, Listed>;
	/** Records whose title or abstract is being translated right now. */
	titlesPending: boolean;
	abstractsPending: Set<string>;
	isTranslating: boolean;
	/** The last translation request failed; running again retries it. */
	failed: boolean;
	/** Translation ran for the listed records and finished. */
	done: boolean;
	listedCount: number;
	/** The list loaded with nothing in it: nothing to translate, so no control. */
	empty: boolean;
	active: boolean;
	/** The reader chose to read this record translated, here or on another page. */
	showing: (key: string) => boolean;
	run: () => void;
	undo: () => void;
	originals: Set<string>;
	toggleOriginal: (key: string) => void;
};

const ResultsTranslationContext = createContext<ResultsTranslation | null>(null);

type Listed = { key: string; title: string; abstract: string };

type TranslationRequest = readonly ["record-translation", TranslationPart, string, string[], number];

async function translatePart([, part, language, keys]: TranslationRequest) {
	const response = await fetch("/api/ai/translate", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ part, language, keys, distinctId: getAnalyticsDistinctId() ?? undefined }),
	});
	if (!response.ok) throw new Error(`Translation failed: ${response.status}`);
	const { translations } = (await response.json()) as { translations: Record<string, RecordTranslation> };
	saveTranslations(part, language, translations);
	return translations;
}

const swrOptions = {
	revalidateOnFocus: false,
	revalidateOnReconnect: false,
	shouldRetryOnError: false,
	keepPreviousData: false,
};

/** The records in this list with a stored translation missing: the request asks for those alone. */
const missingIn = (store: TranslationStore | null, part: TranslationPart, target: string, records: Listed[]) =>
	store ? records.filter((record) => !translationIn(store, part, target, record.key, record[part])) : [];

/** One batch of abstracts, asking only for those this browser hasn't stored yet. */
function useAbstractBatch(active: boolean, store: TranslationStore | null, target: string, attempt: number, batch: Listed[]) {
	const missing = missingIn(store, "abstract", target, batch);
	const keys = missing.map(({ key }) => key);
	const query = useSWR<Record<string, RecordTranslation>, Error, TranslationRequest | null>(
		active && keys.length > 0 ? ["record-translation", "abstract", target, keys, attempt] : null,
		translatePart,
		swrOptions,
	);
	return { keys, isLoading: active && query.isLoading, failed: Boolean(query.error) };
}

type Translatable = { key: string; title?: string | null; abstractNote?: string | null };

type ProviderProps = { items: Translatable[] | undefined; scope?: "results" | "record"; children: ReactNode };

/** Settings and stored translations are the browser's, so results and item pages share them. */
export function ResultsTranslationProvider(props: ProviderProps) {
	const enabled = useFeatureFlagEnabled("ai-translation");
	return enabled ? <EnabledProvider {...props} /> : props.children;
}

function EnabledProvider({ items, scope = "results", children }: ProviderProps) {
	const locale = useLocale();
	const localeLanguage = LOCALE_LANGUAGE[locale] ?? locale;
	const store = useTranslationStore();
	const [choice, setChoice] = useLocalStorage("results-translation-language", CURRENT_LOCALE, STORED_SETTING);
	const [auto, setAutoStored] = useLocalStorage("results-translation-auto", false, STORED_SETTING);
	const [attempt, setAttempt] = useState(0);
	const [originals, setOriginals] = useState<Set<string>>(new Set());
	const target = choice === CURRENT_LOCALE ? localeLanguage : choice;

	const listed = useMemo(
		() =>
			(items ?? []).map((item) => ({
				key: item.key,
				title: zoteroMarkupToPlainText(item.title),
				abstract: zoteroMarkupToPlainText(item.abstractNote),
			})),
		[items],
	);
	const shown = useShown();
	const listedKeys = listed.map(({ key }) => key);
	const chosen = listed.length > 0 && listedKeys.every((key) => shown.has(shownKey(target, key)));
	const active = store !== null && listed.length > 0 && (auto || chosen);

	const titleKeys = missingIn(store, "title", target, listed.filter(({ title }) => title)).map(({ key }) => key);
	const titlesQuery = useSWR<Record<string, RecordTranslation>, Error, TranslationRequest | null>(
		active && titleKeys.length > 0 ? ["record-translation", "title", target, titleKeys, attempt] : null,
		translatePart,
		swrOptions,
	);
	// A results page holds 20 records: four batches of five, one hook each, fixed by the list's order.
	const withAbstracts = listed.filter(({ abstract }) => abstract);
	const batches = [0, 1, 2, 3].map((i) => withAbstracts.slice(i * ABSTRACTS_PER_REQUEST, (i + 1) * ABSTRACTS_PER_REQUEST));
	const batchQueries = [
		useAbstractBatch(active, store, target, attempt, batches[0]),
		useAbstractBatch(active, store, target, attempt, batches[1]),
		useAbstractBatch(active, store, target, attempt, batches[2]),
		useAbstractBatch(active, store, target, attempt, batches[3]),
	];
	const abstractsPending = new Set(batchQueries.flatMap(({ keys, isLoading }) => (isLoading ? keys : [])));
	const titlesPending = active && titlesQuery.isLoading;
	const isTranslating = titlesPending || abstractsPending.size > 0;
	const failed = active && (Boolean(titlesQuery.error) || batchQueries.some((batch) => batch.failed));

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
			if (!next) setShown(target, listedKeys, false);
			setOriginals(new Set());
		},
		store,
		sources: new Map(listed.map((record) => [record.key, record])),
		titlesPending,
		abstractsPending,
		isTranslating,
		failed,
		done: active && !isTranslating && !failed,
		listedCount: listed.length,
		empty: items !== undefined && listed.length === 0,
		active,
		showing: (key) => auto || shown.has(shownKey(target, key)),
		run: () => {
			setShown(target, listedKeys, true);
			if (failed) setAttempt((previous) => previous + 1);
			setOriginals(new Set());
		},
		// Off as well, or the next page would translate itself straight away.
		undo: () => {
			setAutoStored(false);
			setShown(target, listedKeys, false);
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
	if (!context || !key || !context.showing(key)) return null;
	const source = context.sources.get(key);
	if (!source) return null;
	const { store, target } = context;
	const title = source.title ? translationIn(store, "title", target, key, source.title) : undefined;
	const abstract = source.abstract ? translationIn(store, "abstract", target, key, source.abstract) : undefined;
	// The title says which language the record is in; a record without one goes by its abstract.
	const lead = source.title ? title : abstract;
	const abstractPending = context.abstractsPending.has(key);
	if (!lead) return (source.title ? context.titlesPending : abstractPending) ? { pending: true as const } : null;
	if (lead.same) return null;
	return {
		pending: false as const,
		title: title && !title.same ? title.text : undefined,
		abstract: abstract && !abstract.same ? abstract.text : undefined,
		abstractPending,
		sourceName: title?.source ? languageName(title.source, locale) : null,
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
	if (!context || context.empty) return null;

	const { target, choice, auto, isTranslating, done, failed, listedCount, scope } = context;
	const record = scope === "record";
	const pageLanguage = languageNames(LOCALE_LANGUAGE[locale] ?? locale, locale);
	const targetLanguage = languageNames(target, locale);
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
					aria-label={t(record ? "buttonLabelRecord" : "buttonLabel", { language: targetLanguage.inPage })}
					size={record ? "sm" : undefined}
					className={twMerge(
						record ? "shrink-0" : "h-full min-w-0 shrink-0 gap-1.5 px-3 xl:gap-2 xl:px-4",
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
					{/* Narrow phones keep the icon alone; the button's name still says the language. */}
					<span
						className={twMerge(
							"rounded-md bg-black/[6%] px-1.5 py-0.5 text-xs font-semibold tabular-nums dark:bg-white/10",
							!record && "[@media(max-width:389px)]:hidden",
						)}
					>
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

								{failed && (
									<p role="alert" className="-mt-2 text-sm text-danger">
										{t("failed")}
									</p>
								)}
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
