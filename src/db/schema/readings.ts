import { itemIdentity, itemSourceLink, sourceConnection } from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import { bigint, boolean, doublePrecision, foreignKey, index, integer, pgTable, primaryKey, real, text, timestamp, varchar } from "drizzle-orm/pg-core";
import type { ScreeningGrade } from "@/config/library-config/schema";
import type { Region } from "@/lib/readings/questions";
import type { StudyTypeKey } from "@/lib/readings/study-types";
import { associationDeliveryColumns } from "./author-associations";

/**
 * What Jev read a record as, from the title and abstract it hashed. It is read again only when that text or the
 * question set changes. `typedBy` is `metadata` when the record's own type, OpenAlex type or DOI said what it is.
 * `screenedOut` hides the record from readers: every source that holds it screens it and keeps its grade out.
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
	/** What Jev read: the title and abstract, the title alone when the record has no abstract, or the PDF's opening. */
	input: text("input").$type<"abstract" | "title" | "pdf">().notNull(),
	contentHash: text("contentHash").notNull(),
	/**
	 * Whether a call of a type that needs its words (a meta-analysis, a randomised trial) found them in the record's
	 * title, abstract or PDF text; without them the call is uncertain. Null for other types, and until it is checked.
	 */
	typeWords: boolean("typeWords"),
	questionSet: integer("questionSet").notNull(),
	model: text("model").notNull(),
	readAt: timestamp("readAt", { withTimezone: true }).notNull().defaultNow(),
	screenedOut: boolean("screenedOut").notNull().default(false),
});

/**
 * A record's grade against one screening source's subject: a score from 0 (not about it) to 3 (about it). It belongs
 * to the record's link to that source, so it goes when the source no longer holds the record. After the source's
 * subject changes, new grades wait in the pending columns until the last record is graded, then all take over at once.
 */
export const itemGrade = pgTable("itemGrade", {
	itemKey: varchar("itemKey", { length: 8 }).notNull(),
	sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 }).notNull(),
	score: real("score").notNull(),
	grade: text("grade").$type<ScreeningGrade>().notNull(),
	subjectHash: text("subjectHash").notNull(),
	pendingScore: real("pendingScore"),
	pendingGrade: text("pendingGrade").$type<ScreeningGrade>(),
	pendingSubjectHash: text("pendingSubjectHash"),
	gradedAt: timestamp("gradedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
	primaryKey({ columns: [table.itemKey, table.sourceConnectionKey] }),
	foreignKey({ columns: [table.itemKey, table.sourceConnectionKey], foreignColumns: [itemSourceLink.itemKey, itemSourceLink.sourceConnectionKey] }).onDelete("cascade").onUpdate("cascade"),
	index("itemGrade_source_idx").on(table.sourceConnectionKey),
	index("itemGrade_pending_idx").on(table.sourceConnectionKey).where(sql`${table.pendingSubjectHash} IS NOT NULL`),
	index("itemGrade_latest_idx").on(table.sourceConnectionKey, table.grade, table.gradedAt),
]);

/**
 * Records waiting to be read: new and changed ones from the outbox, leased, retried with backoff. `requestedFor` names
 * the sources whose owner's request to grade queued the record, which is then graded for those sources only; it is
 * null when the record was queued for its own reasons.
 */
export const itemReadingQueue = pgTable("itemReadingQueue", {
	itemKey: varchar("itemKey", { length: 8 }).primaryKey(),
	generation: bigint("generation", { mode: "number" }).notNull().default(1),
	requestedFor: text("requestedFor").array(),
	...associationDeliveryColumns,
}, (table) => [index("itemReadingQueue_pending_idx").on(table.nextAttemptAt).where(sql`${table.nextAttemptAt} IS NOT NULL`)]);

/**
 * The screening of each source that screens, as its configuration last set it, so the database alone can say which
 * grades it keeps out and OpenScholar can see which subject it screens against. `gradingOf` is how many records the
 * owner asked to have graded, until they all are.
 */
export const sourceScreening = pgTable("sourceScreening", {
	sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 }).primaryKey().references(() => sourceConnection.key, { onDelete: "cascade" }),
	subject: text("subject").notNull(),
	subjectHash: text("subjectHash").notNull(),
	keptOut: text("keptOut").array().$type<ScreeningGrade[]>().notNull(),
	gradingOf: integer("gradingOf"),
});

/** What a library spent on reading, one row a day, so owners see it. */
export const readingSpend = pgTable("readingSpend", {
	day: text("day").primaryKey(),
	reads: integer("reads").notNull().default(0),
	usd: doublePrecision("usd").notNull().default(0),
});
