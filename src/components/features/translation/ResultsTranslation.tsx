"use client";

import { createContext, ReactNode, use, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import useSWR from "swr";
import { useLocalStorage } from "usehooks-ts";
import { Popover, PopoverContent, PopoverTrigger, Spinner } from "@nextui-org/react";
import { MdTranslate } from "react-icons/md";
import { IoCheckmarkCircle, IoArrowUndo } from "react-icons/io5";
import { twMerge } from "tailwind-merge";
import { Button } from "@/components/nextui/Button";
import { Select } from "@/components/nextui/Select";
import { SelectItem } from "@/components/nextui/SelectItem";
import { Switch } from "@/components/nextui/Switch";
import type { ListItem } from "@/app/api/item/types";

/** Languages results can be translated into, each named in itself. */
export const TRANSLATION_LANGUAGES = [
	{ code: "en", name: "English" },
	{ code: "fr", name: "Français" },
	{ code: "sw", name: "Kiswahili" },
	{ code: "pt", name: "Português" },
	{ code: "ar", name: "العربية" },
	{ code: "de", name: "Deutsch" },
	{ code: "hi", name: "हिन्दी" },
	{ code: "zh", name: "中文" },
] as const;

const LOCALE_LANGUAGE: Record<string, string> = { "en-GB": "en", "en-US": "en", cn: "zh" };
const CURRENT_LOCALE = "locale";

type Translation = { title: string; abstract: string; source: string; same: boolean };

type ResultsTranslation = {
	target: string;
	choice: string;
	setChoice: (choice: string) => void;
	auto: boolean;
	setAuto: (auto: boolean) => void;
	translations: Record<string, Translation> | undefined;
	isTranslating: boolean;
	listedCount: number;
	active: boolean;
	run: () => void;
	undo: () => void;
	originals: Set<string>;
	toggleOriginal: (key: string) => void;
};

const ResultsTranslationContext = createContext<ResultsTranslation | null>(null);

async function translate([, target, items]: [string, string, Array<{ key: string; title: string; abstract: string }>]) {
	const response = await fetch("/api/mock-translate", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ target, items }),
	});
	if (!response.ok) throw new Error(await response.text());
	return ((await response.json()) as { translations: Record<string, Translation> }).translations;
}

const plain = (markup: string | undefined) => (markup ?? "").replace(/<[^>]+>/g, "");

export function ResultsTranslationProvider({ items, children }: { items: ListItem[] | undefined; children: ReactNode }) {
	const locale = useLocale();
	const localeLanguage = LOCALE_LANGUAGE[locale] ?? locale;
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
	const active = listed.length > 0 && (auto || ranFor === signature);

	const { data: translations, isLoading } = useSWR(
		active ? ["mock-translate", target, listed] : null,
		translate,
		{ revalidateOnFocus: false, keepPreviousData: false },
	);

	const value: ResultsTranslation = {
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
		translations: active ? translations : undefined,
		isTranslating: active && isLoading,
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

/** The record's text in the chosen language while translation is on, else null. */
export function useItemTranslation(key: string | undefined) {
	const context = use(ResultsTranslationContext);
	const locale = useLocale();
	if (!context || !key) return null;
	const translation = context.translations?.[key];
	const pending = context.isTranslating;
	if (!translation || translation.same) return pending ? { pending: true as const } : null;
	const showingOriginal = context.originals.has(key);
	return {
		pending: false as const,
		title: translation.title,
		abstract: translation.abstract,
		sourceName: new Intl.DisplayNames([locale], { type: "language" }).of(translation.source) ?? translation.source,
		showingOriginal,
		toggle: () => context.toggleOriginal(key),
	};
}

export function ResultsTranslationControl() {
	const context = use(ResultsTranslationContext);
	const t = useTranslations("translation");
	const locale = useLocale();
	const [isOpen, setIsOpen] = useState(false);
	if (!context) return null;

	const { target, choice, auto, isTranslating, active, translations, listedCount } = context;
	const localeLanguage = TRANSLATION_LANGUAGES.find(({ code }) => code === (LOCALE_LANGUAGE[locale] ?? locale));
	const targetName = TRANSLATION_LANGUAGES.find(({ code }) => code === target)?.name ?? target;
	const done = active && !isTranslating && !!translations;

	return (
		<Popover placement="bottom-end" isOpen={isOpen} onOpenChange={setIsOpen} offset={8}>
			<PopoverTrigger>
				<Button
					aria-label={t("buttonLabel", { language: targetName })}
					className={twMerge(
						"h-full shrink-0 gap-2 px-4 xl:px-4",
						done && "border-accent text-accent dark:text-accent",
						isOpen && "outline outline-2 outline-focus",
					)}
					startContent={
						isTranslating ? (
							<Spinner size="sm" color="current" classNames={{ wrapper: "size-5" }} />
						) : done ? (
							<IoCheckmarkCircle className="size-5 shrink-0" />
						) : (
							<MdTranslate className="size-5 shrink-0" />
						)
					}
				>
					{/* Both labels share one cell so the button keeps the longer one's width when it switches. */}
					<span className="hidden xl:inline-grid justify-items-start">
						<span className={twMerge("col-start-1 row-start-1", done && "invisible")}>{t("translate")}</span>
						<span className={twMerge("col-start-1 row-start-1", !done && "invisible")}>{t("translated")}</span>
					</span>
					<span className="rounded-md bg-black/[6%] px-1.5 py-0.5 text-xs font-semibold tabular-nums dark:bg-white/10">
						{target.toUpperCase()}
					</span>
				</Button>
			</PopoverTrigger>
			<PopoverContent className="w-80 rounded-2xl border-small border-black/10 bg-white p-0 dark:border-white/10 dark:bg-secondary">
				<div className="flex w-full flex-col gap-4 p-4">
					<p className="text-base font-medium text-black/80 dark:text-white/80">{t("title")}</p>

					<label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl bg-black/[4%] p-3 dark:bg-white/[4%]">
						<span className="flex min-w-0 flex-col gap-0.5">
							<span className="text-sm font-medium text-black/80 dark:text-white/80">{t("auto")}</span>
							<span className="text-xs text-black/50 dark:text-white/50">{t("autoHint")}</span>
						</span>
						<Switch size="sm" isSelected={auto} onValueChange={context.setAuto} classNames={{ base: "m-0 shrink-0" }} />
					</label>

					<Select
						label={t("into")}
						labelPlacement="outside"
						placement="left"
						selectedKeys={[choice]}
						disallowEmptySelection
						onSelectionChange={(keys) => {
							const next = Array.from(keys)[0];
							if (typeof next === "string") context.setChoice(next);
						}}
						classNames={{
							base: "max-w-none",
							trigger: "h-12",
							label: "text-sm text-black/60 dark:text-white/60 !text-left",
							popoverContent: "rounded-2xl",
						}}
						renderValue={() =>
							choice === "locale" ? (
								<span className="flex items-baseline gap-2">
									{t("currentLocale")}
									<span className="text-sm font-normal text-black/50 dark:text-white/50">{localeLanguage?.name}</span>
								</span>
							) : (
								targetName
							)
						}
					>
						{[
							<SelectItem key="locale" description={localeLanguage?.name} textValue={t("currentLocale")}>
								{t("currentLocale")}
							</SelectItem>,
							...TRANSLATION_LANGUAGES.filter(({ code }) => code !== localeLanguage?.code).map(({ code, name }) => (
								<SelectItem key={code} textValue={name}>
									{name}
								</SelectItem>
							)),
						]}
					</Select>

					<Button
						color={done ? "secondary" : "accent"}
						className="h-11 w-full"
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
							? t("translating", { count: listedCount })
							: done
								? t("showOriginals")
								: t("run", { count: listedCount })}
					</Button>
				</div>
			</PopoverContent>
		</Popover>
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
				: t("translatedFrom", { language: translation.sourceName })}
		</button>
	);
}
