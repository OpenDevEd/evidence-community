import { itemIdentity } from "@opendeved/evidence-library-core";
import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";

import type { AdminImportCommitResult, PdfCheckResult, PdfReading } from "@/lib/admin/item-import-contract";
import type { ReviewActor } from "@/lib/admin/review-service";
import type { PublishingChoice } from "@/lib/admin/review-contract";

/** Sending an import's drafts on as the editor who imported them, with the DOI route they chose (null: no DOI). */
/** `publish`: whether the importer chose to publish; an import saved before the choice existed published for an Editor or Owner. */
export type ImportSend = { actor: ReviewActor; route: PublishingChoice["route"] | null; publish?: boolean } | null;

/** Whether an import's drafts are published as they go on, not sent to the review queue: only by an Editor or Owner who chose to. */
export const sendPublishes = (send: NonNullable<ImportSend>) => send.actor.role !== "creator" && send.publish !== false;

/** The library's PDF import: one at a time, read in the publication worker, closed once imported or discarded. */
export const pdfImport = pgTable("pdfImport", {
	id: uuid("id").primaryKey().defaultRandom(),
	createdBy: text("createdBy").notNull(),
	createdAt: timestamp("createdAt", { withTimezone: true }).notNull().defaultNow(),
	checks: jsonb("checks").$type<string[]>().notNull(),
	instructions: text("instructions").notNull(),
	collections: jsonb("collections").$type<string[]>().notNull(),
	/** Set while one request imports the records, so a second can't import them again. */
	commitStartedAt: timestamp("commitStartedAt", { withTimezone: true }),
	results: jsonb("results").$type<AdminImportCommitResult[]>(),
	/** Whether the drafts go on once their PDFs are attached, as whom and with which DOI route; null keeps them as drafts. */
	send: jsonb("send").$type<ImportSend>(),
	closedAt: timestamp("closedAt", { withTimezone: true }),
	/** Set once a closed import's stored PDFs are gone, confirmed uploads or not. */
	filesRemovedAt: timestamp("filesRemovedAt", { withTimezone: true }),
}, (table) => [
	uniqueIndex("pdfImport_one_open").on(sql`(true)`).where(sql`${table.closedAt} IS NULL`),
]);

/** One PDF of an import, stored privately until imported; the worker claims it with a lease, as the association queues do. */
export const pdfImportFile = pgTable("pdfImportFile", {
	id: uuid("id").primaryKey().defaultRandom(),
	importId: uuid("importId").notNull().references(() => pdfImport.id, { onDelete: "cascade" }),
	position: integer("position").notNull(),
	filename: text("filename").notNull(),
	/** Null until the PDF is uploaded. */
	objectPath: text("objectPath"),
	uploadedAt: timestamp("uploadedAt", { withTimezone: true }),
	reading: jsonb("reading").$type<PdfReading>(),
	attempts: integer("attempts").notNull().default(0),
	nextAttemptAt: timestamp("nextAttemptAt", { withTimezone: true }),
	leaseToken: text("leaseToken"),
	leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
	lastError: text("lastError"),
	/** The file's SHA-256, kept before the AI reads it, so a repeat of it in the import is known. */
	sha256: text("sha256"),
	/** The draft importing made from this PDF, which the worker gives the PDF. */
	attachTo: text("attachTo"),
	/** Sending the imported draft on: waiting for its PDF and the worker, sent, held for something publishing needs, or failed. */
	sendState: text("sendState", { enum: ["waiting", "sent", "held", "failed"] }),
	sendError: text("sendError"),
	attachState: text("attachState").$type<"waiting" | "attached" | "failed">(),
	/** The attachment draft the worker made for this PDF, kept so an interrupted attachment carries on with it. */
	attachmentKey: text("attachmentKey"),
}, (table) => [
	uniqueIndex("pdfImportFile_position").on(table.importId, table.position),
	// One PDF of an import reads a file; another with the same contents repeats it.
	uniqueIndex("pdfImportFile_same_file").on(table.importId, table.sha256),
	index("pdfImportFile_pending_idx").on(table.nextAttemptAt).where(sql`${table.nextAttemptAt} IS NOT NULL`),
]);

/**
 * The AI checks a PDF import read a record's PDF against, kept with the exact
 * upload they were read from: the attachment, and the private object its PDF
 * was uploaded as, which publishing keeps as the published copy's source. A
 * PDF uploaded in its place is another object, which these checks don't cover.
 */
export const itemImportCheck = pgTable("itemImportCheck", {
	attachmentKey: varchar("attachmentKey", { length: 8 }).primaryKey().references(() => itemIdentity.key, { onDelete: "cascade" }),
	/** The record the PDF is attached to. */
	parentKey: varchar("parentKey", { length: 8 }).notNull(),
	objectPath: text("objectPath").notNull(),
	sha256: varchar("sha256", { length: 64 }).notNull(),
	filename: text("filename").notNull(),
	checks: jsonb("checks").$type<PdfCheckResult[]>().notNull(),
	/** The changes the AI suggested that would meet some of the checks, by their place. */
	suggestions: jsonb("suggestions").$type<{ checks: number[]; field: string; value: string }[]>().notNull(),
	readAt: timestamp("readAt", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("itemImportCheck_parent_idx").on(table.parentKey)]);
