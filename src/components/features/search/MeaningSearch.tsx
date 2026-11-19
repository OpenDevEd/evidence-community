"use client";

import { createContext, ReactNode, use } from "react";
import { useTranslations } from "next-intl";
import { twMerge } from "tailwind-merge";
import { TbWorldSearch } from "react-icons/tb";
import { Tooltip } from "@/components/nextui/Tooltip";
import { FEW_WORD_MATCHES, type MeaningInfo } from "@/lib/meaning-search-rules";

type MeaningSearchState = {
	meaning: MeaningInfo | undefined;
	setWordsOnly: (wordsOnly: boolean) => void;
};

const MeaningSearchContext = createContext<MeaningSearchState | null>(null);

export function MeaningSearchProvider({ value, children }: { value: MeaningSearchState; children: ReactNode }) {
	return <MeaningSearchContext.Provider value={value}>{children}</MeaningSearchContext.Provider>;
}

/** Why a result can match by meaning: other words, another language. */
function MeaningTooltip({ children }: { children: ReactNode }) {
	const t = useTranslations("meaningSearch");
	return (
		<Tooltip
			delay={0}
			closeDelay={0}
			placement="bottom-start"
			content={
				<span className="flex max-w-72 flex-col gap-1 px-1 py-1.5">
					<span className="text-sm font-semibold text-black/80 dark:text-white/90">{t("whyMeaningTitle")}</span>
					<span className="text-sm text-black/60 dark:text-white/60">{t("whyMeaningBody")}</span>
				</span>
			}
		>
			{children}
		</Tooltip>
	);
}

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
	const t = useTranslations("meaningSearch");
	return (
		<div className={twMerge("flex items-center gap-4 rounded-xl bg-white dark:bg-white/[4%]", compact ? "px-3 py-2" : "px-4 py-3")}>
			<MeaningTooltip>
				<button
					type="button"
					aria-label={t("whyMeaningTitle")}
					className={twMerge(
						"flex shrink-0 cursor-help items-center justify-center rounded-full bg-accent/10 text-accent outline-none focus-visible:ring-2 focus-visible:ring-focus",
						compact ? "size-8" : "size-10",
					)}
				>
					<TbWorldSearch className={compact ? "size-4" : "size-5"} />
				</button>
			</MeaningTooltip>
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
					: "border border-black/10 bg-white text-black/80 hover:bg-black/[4%] dark:border-white/10 dark:bg-secondary dark:text-white/80",
			)}
		>
			{accent && <TbWorldSearch className="size-4 shrink-0" />}
			{children}
		</button>
	);
}

/** Above the results: how much of the list came by meaning, and the switch to hide or bring those results back. */
export function MeaningResultNote() {
	const state = use(MeaningSearchContext);
	const t = useTranslations("meaningSearch");
	if (!state?.meaning) return null;
	const { meaning, setWordsOnly } = state;
	const { wordsTotal } = meaning;

	if (meaning.wordsOnly) {
		return (
			<MeaningNote
				title={t("showingWordMatches", { count: wordsTotal })}
				body={t("meaningHidden")}
				action={
					<NoteAction accent onPress={() => setWordsOnly(false)}>
						{t("showMeaningResults")}
					</NoteAction>
				}
			/>
		);
	}
	const hide = <NoteAction onPress={() => setWordsOnly(true)}>{t("showOnlyWordMatches", { count: wordsTotal })}</NoteAction>;
	if (wordsTotal === 0) return <MeaningNote title={t("noWordMatches")} body={t("allByMeaning")} />;
	if (wordsTotal < FEW_WORD_MATCHES) {
		return <MeaningNote title={t("fewWordMatches", { count: wordsTotal })} body={t("restByMeaning")} action={hide} />;
	}
	if (meaning.meaningOnlyKeys.length > 0) return <MeaningNote compact title={t("someByMeaning")} action={hide} />;
	return null;
}

/** In a result's footer, when only its meaning matched the search. */
export function MeaningResultChip({ itemKey }: { itemKey: string | undefined }) {
	const state = use(MeaningSearchContext);
	const t = useTranslations("meaningSearch");
	if (!itemKey || !state?.meaning?.meaningOnlyKeys.includes(itemKey)) return null;
	return (
		<MeaningTooltip>
			<span
				tabIndex={0}
				className="ms-2 inline-flex h-8 cursor-help items-center gap-1.5 rounded-xl bg-black/5 px-3 text-xs font-medium text-black/60 outline-none focus-visible:ring-2 focus-visible:ring-focus dark:bg-white/10 dark:text-white/70"
			>
				<TbWorldSearch className="size-3.5 shrink-0" />
				{t("similarMeaning")}
			</span>
		</MeaningTooltip>
	);
}
