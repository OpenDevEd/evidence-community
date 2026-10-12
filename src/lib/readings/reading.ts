import { eq } from "drizzle-orm";
import type { Database } from "@/db/database-schema";
import { itemReading } from "@/db/schema/readings";
import type { StudyReading, StudyTypeKey } from "./study-types";

type ReadingRow = Pick<typeof itemReading.$inferSelect, "studyType" | "typeConfidence" | "typedBy" | "input">;

/** A record's study type as readers see it: an editor's correction wins over what the reading found. */
export function studyReadingOf(row: ReadingRow | undefined, corrected: StudyTypeKey | null | undefined): StudyReading | null {
	if (corrected) return { type: corrected, by: "editor" };
	return row ? { type: row.studyType, confidence: row.typeConfidence, by: row.typedBy, input: row.input } : null;
}

/** What the reading found for a record, whatever an editor chose; null before it is read. */
export async function readStudyReading(db: Pick<Database, "select">, itemKey: string) {
	const [row] = await db
		.select({ studyType: itemReading.studyType, typeConfidence: itemReading.typeConfidence, typedBy: itemReading.typedBy, input: itemReading.input })
		.from(itemReading)
		.where(eq(itemReading.itemKey, itemKey))
		.limit(1);
	return studyReadingOf(row, null);
}
