import { sql, type SQL } from "drizzle-orm";
import { item } from "@/db/schema/tables/item";
import { SYNTHESIS_TYPES } from "@/lib/readings/study-types";

/** A record's study type: an editor's correction, else what its reading found; null until it has been read. */
export const recordStudyType = sql`coalesce(${item.studyType}, (SELECT "studyType" FROM "itemReading" WHERE "itemReading"."itemKey" = ${item.key}))`;

const synthesisTypes = sql.join(SYNTHESIS_TYPES.map((type) => sql`${type}`), sql`, `);
/** Whether a study type is a review or synthesis; false for a record not read yet. */
export const isSynthesis = (type: SQL) => sql`coalesce(${type} IN (${synthesisTypes}), false)`;

/** A digest's stored publication that is a review or synthesis, by the type it was listed with. */
export const storedSynthesis = isSynthesis(sql`stored.entry->>'studyType'`);
/** A digest's reviews and syntheses in the order readers start from, the others after them. */
export const storedTypeOrder = sql`CASE stored.entry->>'studyType' ${sql.join(SYNTHESIS_TYPES.map((type, index) => sql`WHEN ${type} THEN ${index}`), sql` `)} ELSE ${SYNTHESIS_TYPES.length} END`;

