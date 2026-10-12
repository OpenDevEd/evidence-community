import { itemIdentity, itemSourceLink } from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import { bigint, doublePrecision, foreignKey, index, integer, pgTable, primaryKey, real, text, timestamp, varchar } from "drizzle-orm/pg-core";
import type { Region } from "@/lib/readings/questions";
import type { StudyTypeKey } from "@/lib/readings/study-types";
import { associationDeliveryColumns } from "./author-associations";

/**
 * What Jev read a record as, from the title and abstract it hashed. It is read again only when that text or the
 * question set changes. `typedBy` is `metadata` when the record's own type, OpenAlex type or DOI said what it is.
 */
export const itemReading = pgTable("itemReading", {
	itemKey: varchar("itemKey", { length: 8 }).primaryKey().references(() => itemIdentity.key, { onDelete: "cascade" }),
	studyType: text("studyType").$type<StudyTypeKey>().notNull(),
	typeConfidence: real("typeConfidence").notNull(),
	typedBy: text("typedBy").$type<"ai" | "metadata">().notNull(),
	/** How likely it is the authors pooled results from earlier studies themselves. */
	pooled: real("pooled").notNull(),
	region: text("region").$type<Region>().notNull(),
	/** How likely it is the abstract reports a quantitative result of the work. */
	effects: real("effects").notNull(),
	/** What Jev read: the title and abstract, or the title alone when the record has no abstract. */
	input: text("input").$type<"abstract" | "title">().notNull(),
	contentHash: text("contentHash").notNull(),
	questionSet: integer("questionSet").notNull(),
	model: text("model").notNull(),
	readAt: timestamp("readAt", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * A record's grade against one screening source's subject: a score from 0 (not about it) to 3 (about it). It belongs
 * to the record's link to that source, so it goes when the source no longer holds the record.
 */
export const itemGrade = pgTable("itemGrade", {
	itemKey: varchar("itemKey", { length: 8 }).notNull(),
	sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 }).notNull(),
	score: real("score").notNull(),
	subjectHash: text("subjectHash").notNull(),
	gradedAt: timestamp("gradedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
	primaryKey({ columns: [table.itemKey, table.sourceConnectionKey] }),
	foreignKey({ columns: [table.itemKey, table.sourceConnectionKey], foreignColumns: [itemSourceLink.itemKey, itemSourceLink.sourceConnectionKey] }).onDelete("cascade").onUpdate("cascade"),
	index("itemGrade_source_idx").on(table.sourceConnectionKey),
]);

/** Records waiting to be read: new and changed ones from the outbox, leased, retried with backoff. */
export const itemReadingQueue = pgTable("itemReadingQueue", {
	itemKey: varchar("itemKey", { length: 8 }).primaryKey(),
	generation: bigint("generation", { mode: "number" }).notNull().default(1),
	...associationDeliveryColumns,
}, (table) => [index("itemReadingQueue_pending_idx").on(table.nextAttemptAt).where(sql`${table.nextAttemptAt} IS NOT NULL`)]);

/** What a library spent on reading, one row a day, so owners see it. */
export const readingSpend = pgTable("readingSpend", {
	day: text("day").primaryKey(),
	reads: integer("reads").notNull().default(0),
	usd: doublePrecision("usd").notNull().default(0),
});
