"use client";

import { AiMagicIcon, Database02Icon, UserEdit01Icon } from "@hugeicons/core-free-icons";
import { useTranslations } from "next-intl";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Hint } from "@/components/nextui/Tooltip";
import { SURE, studyType, type StudyReading, type StudyTypeKey } from "@/lib/readings/study-types";
import { twMerge } from "@/lib/tw-merge";

const ICONS = { ai: AiMagicIcon, metadata: Database02Icon, editor: UserEdit01Icon } as const;

/** How the type was set: by an editor, from the record itself, or read by an AI model and how surely. */
function howTyped(t: ReturnType<typeof useTranslations>, reading: StudyReading, uncertain: boolean) {
	if (reading.by !== "ai") return t(reading.by);
	return t("ai", { input: reading.input, percent: Math.round(reading.confidence * 100), uncertain: uncertain ? "yes" : "no" });
}

/** The tooltip's classes wherever a study type explains itself. */
export const STUDY_TYPE_TIP = "max-w-80 p-3 text-sm";

/** What a study type means, by name, and on a record how it was read. */
export function StudyTypeExplanation({ type, how }: { type: StudyTypeKey; how?: string }) {
	const t = useTranslations("studyTypes");
	return (
		<span className="flex flex-col gap-1.5">
			<span className="font-medium">{t(`types.${type}.label`)}</span>
			<span>{t(`types.${type}.description`)}</span>
			{how && <span className="text-black/60 dark:text-white/60">{how}</span>}
		</span>
	);
}

/**
 * What kind of work a record is, beside its date: a review or synthesis in the library's accent, since readers start
 * there. On hover it says what the type means and how it was read. Nothing until the record has been read.
 */
export function StudyTypeLabel({ reading, className }: { reading: StudyReading | undefined; className?: string }) {
	const t = useTranslations("studyTypes");
	const type = reading && studyType(reading.type);
	if (!reading || !type) return null;
	const uncertain = reading.by === "ai" && reading.confidence < SURE;
	return (
		<Hint
			content={<StudyTypeExplanation type={type.key} how={howTyped(t, reading, uncertain)} />}
			contentClassName={STUDY_TYPE_TIP}
			className={twMerge("gap-1.5 text-lg", type.level === "synthesis" ? "font-medium text-accent" : "text-black/60 dark:text-white/60", className)}
		>
			<HugeiconsIcon icon={ICONS[reading.by]} className="size-4 shrink-0" aria-hidden />
			{t(`types.${type.key}.label`)}
			{uncertain && <span className="font-normal text-black/45 dark:text-white/45">{t("uncertain")}</span>}
		</Hint>
	);
}
