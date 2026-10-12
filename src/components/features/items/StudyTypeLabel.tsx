"use client";

import { AiMagicIcon, Database02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@/components/icons/Hugeicon";
import { Hint } from "@/components/nextui/Tooltip";
import { SURE, studyType, type StudyReading } from "@/lib/readings/study-types";
import { twMerge } from "@/lib/tw-merge";

/** What Jev read to type a record. */
const READ_FROM: Record<StudyReading["input"], string> = {
	abstract: "title and abstract",
	title: "title alone, as the record has no abstract",
	pdf: "opening of its PDF, as the abstract left it unsure",
};

/**
 * What kind of work a record is, beside its date: a review or synthesis in the library's accent, since readers start
 * there. On hover it says what the type means and how it was read. Nothing until the record has been read.
 */
export function StudyTypeLabel({ reading, className }: { reading: StudyReading | undefined; className?: string }) {
	const type = reading && studyType(reading.type);
	if (!reading || !type) return null;
	const uncertain = reading.by === "ai" && reading.confidence < SURE;
	const how = reading.by === "metadata"
		? "Typed from the record itself."
		: `Read by Jev from the ${READ_FROM[reading.input]}, ${Math.round(reading.confidence * 100)}% sure${uncertain ? ", so it is marked uncertain" : ""}.`;
	return (
		<Hint
			content={<span className="flex flex-col gap-1.5"><span className="font-medium">{type.label}</span><span>{type.description}</span><span className="text-black/60 dark:text-white/60">{how}</span></span>}
			contentClassName="max-w-80 p-3 text-sm"
			className={twMerge("gap-1.5 text-lg", type.level === "synthesis" ? "font-medium text-accent" : "text-black/60 dark:text-white/60", className)}
		>
			<HugeiconsIcon icon={reading.by === "metadata" ? Database02Icon : AiMagicIcon} className="size-4 shrink-0" aria-hidden />
			{type.label}
			{uncertain && <span className="font-normal text-black/45 dark:text-white/45">uncertain</span>}
		</Hint>
	);
}
