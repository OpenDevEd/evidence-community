import { itemIdentity } from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import { check, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
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
