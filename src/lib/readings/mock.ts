import "server-only";
import readings from "./mock-readings.json";
import type { StudyReading, StudyTypeKey } from "./study-types";

// ponytail: mock. Real readings live in their own table, written by the reading worker; this file holds Jev's
// answers for ECCAR's records dated 1 September to 12 October 2026, from one real run.
type Stored = StudyReading & { grade: number; pooled: number; region: string; effects: number; date: string };
const ALL = readings as unknown as Record<string, Stored>;

export function readingOf(key: string): StudyReading | undefined {
	const stored = ALL[key];
	return stored && { type: stored.type, confidence: stored.confidence, by: stored.by, input: stored.input };
}

/** The records read as any of these types. */
export function keysOfTypes(types: readonly string[]) {
	return Object.entries(ALL).filter(([, stored]) => types.includes(stored.type)).map(([key]) => key);
}

/** How many records of each type are dated from `first` to `last`, both YYYY-MM-DD and included. */
export function typeCountsIn(first: string, last: string): Partial<Record<StudyTypeKey, number>> {
	const counts: Partial<Record<StudyTypeKey, number>> = {};
	for (const stored of Object.values(ALL)) {
		if (stored.date >= first && stored.date <= last) counts[stored.type] = (counts[stored.type] ?? 0) + 1;
	}
	return counts;
}

/** How many of these records are of each type. */
export function typeCountsOf(keys: readonly string[]): Partial<Record<StudyTypeKey, number>> {
	const counts: Partial<Record<StudyTypeKey, number>> = {};
	for (const key of keys) {
		const type = ALL[key]?.type;
		if (type) counts[type] = (counts[type] ?? 0) + 1;
	}
	return counts;
}
