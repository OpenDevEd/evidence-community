import { STUDY_TYPES, studyType, type StudyLevel, type StudyTypeKey } from "@/lib/readings/study-types";

/** Each level's types in shades of one tone: reviews and syntheses in the accent, since readers start there. */
const LEVEL_RAMP: Record<StudyLevel, string[]> = {
	synthesis: ["bg-accent", "bg-accent/80", "bg-accent/60", "bg-accent/45", "bg-accent/30"],
	primary: ["bg-black/70 dark:bg-white/70", "bg-black/55 dark:bg-white/55", "bg-black/40 dark:bg-white/40", "bg-black/30 dark:bg-white/30", "bg-black/20 dark:bg-white/20"],
	other: ["bg-black/15 dark:bg-white/15", "bg-black/10 dark:bg-white/10", "bg-black/[0.06] dark:bg-white/[0.06]"],
};

/** A study type's colour in bars and swatches, wherever types are counted. */
export const studyTone = (key: StudyTypeKey) => {
	const type = studyType(key)!;
	return LEVEL_RAMP[type.level][STUDY_TYPES.filter((other) => other.level === type.level).findIndex((other) => other.key === key)];
};
