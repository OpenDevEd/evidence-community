"use client";

import { createContext, ReactNode, use } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { MdTranslate } from "react-icons/md";
import { TbAffiliate, TbWorldSearch } from "react-icons/tb";
import { IoClose } from "react-icons/io5";
import { FEW_WORD_MATCHES, SEMANTIC_CONCEPTS, type SemanticInfo } from "@/lib/semantic-concepts";

type SemanticChange = { concept?: number; like?: string; theme?: number; literal?: boolean; wordsOnly?: boolean };

type SemanticState = {
	concept: number;
	theme: number;
	total: number;
	semantic: SemanticInfo | undefined;
	change: (change: SemanticChange) => void;
};

const SemanticContext = createContext<SemanticState | null>(null);

export function SemanticProvider({ value, children }: { value: SemanticState; children: ReactNode }) {
	return <SemanticContext.Provider value={value}>{children}</SemanticContext.Provider>;
}

/** Mock only: flips between the five concepts. */
export function SemanticConceptSwitcher() {
	const state = use(SemanticContext);
	if (!state) return null;
	return (
		<div className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-1 rounded-2xl border-small border-black/10 bg-white p-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.12)] dark:border-white/10 dark:bg-secondary">
			<span className="px-2 text-xs font-medium text-black/50 dark:text-white/50">Mock</span>
			{SEMANTIC_CONCEPTS.map(({ id, name }) => (
				<button
					key={id}
					type="button"
					aria-pressed={state.concept === id}
					onClick={() => state.change({ concept: id })}
					className={twMerge(
						"flex h-9 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors",
						state.concept === id
							? "bg-tertiary text-white"
							: "text-black/60 hover:bg-black/5 dark:text-white/60 dark:hover:bg-white/10",
					)}
				>
					<span className="tabular-nums opacity-60">{id}</span>
					{name}
				</button>
			))}
		</div>
	);
}

const chip = "inline-flex h-9 min-w-0 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors";

/** What the concept did to this search, above the results. */
export function SemanticResultNotes() {
	const state = use(SemanticContext);
	const t = useTranslations("semantic");
	if (!state?.semantic) return null;
	const { semantic, change, theme, total } = state;
	const strong = (chunks: ReactNode) => <strong className="font-semibold text-black/80 dark:text-white/80">{chunks}</strong>;

	if (semantic.understood) {
		const { query, original, literal } = semantic.understood;
		return (
			<div className="flex flex-wrap items-center gap-2">
				<span className={twMerge(chip, "bg-white text-black/60 dark:bg-white/[4%] dark:text-white/60")}>
					<MdTranslate className="size-4 shrink-0 text-accent" />
					<span className="truncate">{t.rich("showingResultsFor", { query: literal ? original : query, q: strong })}</span>
				</span>
				<button
					type="button"
					onClick={() => change({ literal: !literal })}
					className="inline-flex h-9 items-center whitespace-pre rounded-xl px-3 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
				>
					{t.rich("searchInstead", { query: literal ? query : original, q: (chunks) => <span className="underline underline-offset-2">{chunks}</span> })}
				</button>
			</div>
		);
	}

	if (semantic.rescued) return <MeaningNote title={t("rescueTitle")} body={t("rescueBody", { count: total })} />;

	if (semantic.wordsTotal !== undefined) {
		const { wordsTotal } = semantic;
		const hide = <NoteAction onPress={() => change({ wordsOnly: true })}>{t("showOnlyWordMatches", { count: wordsTotal })}</NoteAction>;
		if (semantic.wordsOnly) {
			return (
				<MeaningNote
					title={t("showingWordMatches", { count: wordsTotal })}
					body={t("meaningHidden")}
					action={
						<NoteAction accent onPress={() => change({ wordsOnly: false })}>
							{t("showMeaningResults")}
						</NoteAction>
					}
				/>
			);
		}
		if (wordsTotal === 0) return <MeaningNote title={t("rescueTitle")} body={t("allByMeaning")} />;
		if (wordsTotal < FEW_WORD_MATCHES) {
			return <MeaningNote title={t("fewWordMatches", { count: wordsTotal })} body={t("restByMeaning")} action={hide} />;
		}
		if (semantic.meaningOnlyKeys?.length) {
			return <MeaningNote compact title={t("someByMeaning")} action={hide} />;
		}
		return null;
	}

	if (semantic.similarTo) {
		return (
			<div className="flex min-w-0 items-center gap-2">
				<span className="shrink-0 text-sm text-black/50 dark:text-white/50">{t("similarTo")}</span>
				<span className={twMerge(chip, "bg-white pe-1 text-black/80 dark:bg-white/[4%] dark:text-white/80")}>
					<TbAffiliate className="size-4 shrink-0 text-accent" />
					<span className="truncate">{semantic.similarTo.title}</span>
					<button
						type="button"
						aria-label={t("clear")}
						onClick={() => change({ like: "" })}
						className="flex size-7 shrink-0 items-center justify-center rounded-lg text-black/50 hover:bg-black/5 dark:text-white/50 dark:hover:bg-white/10"
					>
						<IoClose className="size-4" />
					</button>
				</span>
			</div>
		);
	}

	if (semantic.themes) {
		const all = semantic.themes.reduce((sum, { count }) => sum + count, 0);
		const themeChip = (selected: boolean) =>
			twMerge(
				chip,
				selected
					? "bg-tertiary text-white"
					: "bg-white text-black/70 hover:bg-black/[4%] dark:bg-white/[4%] dark:text-white/70",
			);
		return (
			<div className="flex flex-wrap gap-2">
				<button type="button" aria-pressed={theme < 0} onClick={() => change({ theme: -1 })} className={themeChip(theme < 0)}>
					{t("allThemes")}
					<span className="tabular-nums opacity-60">{all}</span>
				</button>
				{semantic.themes.map(({ label, count }, i) => (
					<button key={label} type="button" aria-pressed={theme === i} onClick={() => change({ theme: i })} className={themeChip(theme === i)}>
						{label}
						<span className="tabular-nums opacity-60">{count}</span>
					</button>
				))}
			</div>
		);
	}

	return null;
}

/** Above the results: the list is mostly or wholly by meaning, not by the search's words. */
function MeaningNote({
	title,
	body,
	action,
	compact = false,
}: {
	title: string;
	body?: string;
	action?: ReactNode;
	compact?: boolean;
}) {
	return (
		<div className={twMerge("flex items-center gap-4 rounded-xl bg-white dark:bg-white/[4%]", compact ? "px-3 py-2" : "px-4 py-3")}>
			<span
				className={twMerge(
					"flex shrink-0 items-center justify-center rounded-full bg-accent/10 text-accent",
					compact ? "size-8" : "size-10",
				)}
			>
				<TbWorldSearch className={compact ? "size-4" : "size-5"} />
			</span>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className={twMerge("text-black/80 dark:text-white/80", compact ? "text-sm" : "font-medium")}>{title}</span>
				{body && <span className="text-sm text-black/50 dark:text-white/50">{body}</span>}
			</span>
			{action}
		</div>
	);
}

function NoteAction({ onPress, accent = false, children }: { onPress: () => void; accent?: boolean; children: ReactNode }) {
	return (
		<button
			type="button"
			onClick={onPress}
			className={twMerge(
				"inline-flex h-9 shrink-0 items-center gap-1.5 rounded-xl px-3 text-sm font-medium transition-colors",
				accent
					? "bg-accent text-white hover:brightness-110 dark:bg-accent-500"
					: "border-small border-black/10 bg-white text-black/80 hover:bg-black/[4%] dark:border-white/10 dark:bg-secondary dark:text-white/80",
			)}
		>
			{accent && <TbWorldSearch className="size-4 shrink-0" />}
			{children}
		</button>
	);
}

/** In a result's footer: why Blended listed it, or the way into More like this. */
export function SemanticCardAction({ itemKey }: { itemKey: string | undefined }) {
	const state = use(SemanticContext);
	const t = useTranslations("semantic");
	if (!state || !itemKey) return null;

	if (state.concept === 1 && state.semantic?.meaningOnlyKeys?.includes(itemKey)) {
		return (
			<span className="ms-2 inline-flex h-8 items-center gap-1.5 rounded-xl bg-black/5 px-3 text-xs font-medium text-black/60 dark:bg-white/10 dark:text-white/70">
				<TbWorldSearch className="size-3.5 shrink-0" />
				{t("similarMeaning")}
			</span>
		);
	}

	if (state.concept === 4 && state.semantic?.similarTo?.key !== itemKey) {
		return (
			<button
				type="button"
				onClick={() => {
					state.change({ like: itemKey });
					window.scrollTo({ top: 0, behavior: "smooth" });
				}}
				className="ms-2 inline-flex h-8 items-center gap-1.5 rounded-xl bg-black/5 px-3 text-xs font-medium text-black/60 transition-colors hover:bg-accent/10 hover:text-accent dark:bg-white/10 dark:text-white/70"
			>
				<TbAffiliate className="size-3.5 shrink-0" />
				{t("findSimilar")}
			</button>
		);
	}

	return null;
}
