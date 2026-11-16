import { itemIdentity, sourceConnection } from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import { bigint, boolean, check, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { item } from "./tables/item";
import type { PublishingChoice, ReviewFile, ReviewRecord, ReviewSnapshot } from "@/lib/admin/review-contract";

export const itemPublishingChoice = pgTable("itemPublishingChoice", {
	itemKey: varchar("itemKey", { length: 8 }).primaryKey().references(() => itemIdentity.key),
	choice: jsonb("choice").$type<PublishingChoice>().notNull(),
	updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
});

export const itemReview = pgTable("itemReview", {
	id: uuid("id").primaryKey().defaultRandom(),
	itemKey: varchar("itemKey", { length: 8 }).notNull().references(() => itemIdentity.key),
	state: text("state", { enum: ["pending", "published", "returned", "withdrawn"] }).notNull().default("pending"),
	submittedBy: text("submittedBy").notNull(),
	submittedAt: timestamp("submittedAt", { withTimezone: true }).notNull().defaultNow(),
	snapshot: jsonb("snapshot").$type<ReviewSnapshot>().notNull(),
	corrections: jsonb("corrections").$type<ReviewRecord[]>().notNull().default([]),
	remainingConflicts: jsonb("remainingConflicts").$type<Record<string, string[]>>().notNull().default({}),
	revision: integer("revision").notNull().default(1),
	resolvedBy: text("resolvedBy"),
	resolvedAt: timestamp("resolvedAt", { withTimezone: true }),
	note: text("note"),
}, (table) => [
	uniqueIndex("itemReview_one_pending").on(table.itemKey).where(sql`${table.state} = 'pending'`),
	check("itemReview_state_valid", sql`${table.state} IN ('pending', 'published', 'returned', 'withdrawn')`),
	check("itemReview_resolution_valid", sql`(${table.state} = 'pending' AND ${table.resolvedAt} IS NULL AND ${table.resolvedBy} IS NULL) OR (${table.state} <> 'pending' AND ${table.resolvedAt} IS NOT NULL AND ${table.resolvedBy} IS NOT NULL)`),
]);

/**
 * Who sent an added paper for a review, as Openscholar named them: kept per review, since anyone may send a paper again
 * after a return. A table of its own, because review rows reach every Creator and the email is only for the Editors and
 * Owners who decide the review.
 */
export const itemReviewSender = pgTable("itemReviewSender", {
	reviewId: uuid("reviewId").primaryKey().references(() => itemReview.id, { onDelete: "cascade" }),
	name: varchar("name", { length: 255 }),
	email: varchar("email", { length: 320 }),
	suggested: boolean("suggested").notNull(),
});

export const itemReviewFile = pgTable("itemReviewFile", {
	reviewId: uuid("reviewId").notNull().references(() => itemReview.id, { onDelete: "cascade" }),
	itemKey: varchar("itemKey", { length: 8 }).notNull().references(() => itemIdentity.key),
	objectPath: text("objectPath"),
	coverObjectPath: text("coverObjectPath"),
	file: jsonb("file").$type<ReviewFile>(),
	removalId: uuid("removalId"),
}, (table) => [
	primaryKey({ columns: [table.reviewId, table.itemKey] }),
	check("itemReviewFile_paths_match", sql`(${table.file} IS NULL AND ${table.objectPath} IS NULL AND ${table.coverObjectPath} IS NULL) OR (${table.file} IS NOT NULL AND ${table.objectPath} IS NOT NULL AND ${table.coverObjectPath} IS NOT NULL AND ${table.file}->>'objectPath' = ${table.objectPath} AND ${table.file}->>'coverObjectPath' = ${table.coverObjectPath})`),
]);

export const itemFileRemoval = pgTable("itemFileRemoval", {
	id: uuid("id").notNull().defaultRandom(),
	itemKey: varchar("itemKey", { length: 8 }).primaryKey().references(() => itemIdentity.key),
	createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
});

/** What an editor chose for one Zotero PDF: publish it or take it down, whatever its source's rule. See 0094. */
export type SourceFileChoice = "publish" | "withhold";

export const itemSourceFileChoice = pgTable("itemSourceFileChoice", {
	itemKey: varchar("itemKey", { length: 8 }).primaryKey().references(() => item.key, { onDelete: "cascade" }),
	sourceConnectionKey: varchar("sourceConnectionKey", { length: 64 }).references(() => sourceConnection.key, { onUpdate: "cascade", onDelete: "cascade" }).notNull(),
	sourceRecordKey: varchar("sourceRecordKey", { length: 512 }).notNull(),
	/** The approved choice. */
	choice: text("choice").$type<SourceFileChoice>(),
	/** The change in the working draft, held by `reviewId` while a review is pending. */
	pending: text("pending").$type<SourceFileChoice>(),
	reviewId: uuid("reviewId").references(() => itemReview.id, { onDelete: "set null" }),
	/** False from approval until the source's import has applied the choice. */
	applied: boolean("applied").notNull().default(true),
	/** The PDF's size in Zotero, read when it is staged. */
	sizeBytes: bigint("sizeBytes", { mode: "number" }),
	updatedAt: timestamp("updatedAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
	check("itemSourceFileChoice_choice_valid", sql`${table.choice} IS NULL OR ${table.choice} IN ('publish', 'withhold')`),
	check("itemSourceFileChoice_pending_valid", sql`${table.pending} IS NULL OR ${table.pending} IN ('publish', 'withhold')`),
	check("itemSourceFileChoice_present", sql`${table.choice} IS NOT NULL OR ${table.pending} IS NOT NULL`),
]);
