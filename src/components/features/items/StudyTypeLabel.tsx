"use client";

import { AiMagicIcon, Database02Icon, UserEdit01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Hint } from "@/components/nextui/Tooltip";
import { useLibraryConfig } from "@/context/LibraryConfigProvider";
import { SURE, UNCERTAIN, studyType, type StudyReading, type StudyTypeKey } from "@/lib/readings/study-types";
import { twMerge } from "@/lib/tw-merge";

const ICONS = { ai: AiMagicIcon, metadata: Database02Icon, editor: UserEdit01Icon } as const;

/** How the type was set: by an editor, from the record itself, or read by AI and how surely, the AI mark before the word. */
function howTyped(t: ReturnType<typeof useTranslations>, reading: StudyReading, uncertain: boolean): ReactNode {
	if (reading.by !== "ai") return t(reading.by);
	return t.rich("ai", {
		input: reading.input, percent: Math.round(reading.confidence * 100), uncertain: uncertain ? "yes" : "no",
		ai: (word) => <span className="whitespace-nowrap"><HugeiconsIcon icon={AiMagicIcon} className="mr-1 inline size-3.5 align-[-2px]" aria-hidden />{word}</span>,
	});
}

/** The tooltip's classes wherever a study type explains itself. */
export const STUDY_TYPE_TIP = "max-w-80 p-3 text-sm";

/**
 * What a study type means and what it is not, by name, and on a record how it was read. The Uncertain type of a library
 * that shows uncertain types apart says what that means, and on a record the AI's best guess.
 */
export function StudyTypeExplanation({ type, guess, how }: { type: StudyTypeKey | typeof UNCERTAIN; guess?: StudyTypeKey; how?: ReactNode }) {
	const t = useTranslations("studyTypes");
	const muted = "text-black/60 dark:text-white/60";
	if (type === UNCERTAIN) {
		return (
			<span className="flex flex-col gap-1.5">
				<span className="font-medium">{t("uncertainType.label")}</span>
				<span>{t("uncertainType.description")}</span>
				{guess && <span className={muted}>{t("uncertainType.guess", { type: t(`types.${guess}.label`) })}</span>}
				{how && <span className={muted}>{how}</span>}
			</span>
		);
	}
	return (
		<span className="flex flex-col gap-1.5">
			<span className="font-medium">{t(`types.${type}.label`)}</span>
			<span>{t(`types.${type}.description`)}</span>
			<span className={muted}>{t(`types.${type}.not`)}</span>
			{how && <span className={muted}>{how}</span>}
		</span>
	);
}

/**
 * What kind of work a record is, beside its date: a review or synthesis in the library's accent, since readers start
 * there. On hover it says what the type means and how it was read. An uncertain type is marked so, or, in a library
 * that shows uncertain types apart, reads Uncertain with the AI's guess on hover. Nothing until the record is read.
 */
export function StudyTypeLabel({ reading, className }: { reading: StudyReading | undefined; className?: string }) {
	const t = useTranslations("studyTypes");
	const { filters } = useLibraryConfig();
	const type = reading && studyType(reading.type);
	if (!reading || !type) return null;
	const uncertain = reading.by === "ai" && reading.confidence < SURE;
	const apart = uncertain && filters.uncertainStudyTypes === "separate";
	const how = howTyped(t, reading, uncertain);
	return (
		<Hint
			content={apart ? <StudyTypeExplanation type={UNCERTAIN} guess={type.key} how={how} /> : <StudyTypeExplanation type={type.key} how={how} />}
			contentClassName={STUDY_TYPE_TIP}
			className={twMerge("gap-1.5 text-lg", type.level === "synthesis" && !apart ? "font-medium text-accent" : "text-black/60 dark:text-white/60", className)}
		>
			<HugeiconsIcon icon={ICONS[reading.by]} className="size-4 shrink-0" aria-hidden />
			{apart ? t("uncertainType.label") : t(`types.${type.key}.label`)}
			{uncertain && !apart && <span className="font-normal text-black/45 dark:text-white/45">{t("uncertain")}</span>}
		</Hint>
	);
}
