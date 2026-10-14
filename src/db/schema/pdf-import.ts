import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

import type { AdminImportCommitResult, PdfReading } from "@/lib/admin/item-import-contract";

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
	attachState: text("attachState").$type<"waiting" | "attached" | "failed">(),
	/** The attachment draft the worker made for this PDF, kept so an interrupted attachment carries on with it. */
	attachmentKey: text("attachmentKey"),
}, (table) => [
	uniqueIndex("pdfImportFile_position").on(table.importId, table.position),
	// One PDF of an import reads a file; another with the same contents repeats it.
	uniqueIndex("pdfImportFile_same_file").on(table.importId, table.sha256),
	index("pdfImportFile_pending_idx").on(table.nextAttemptAt).where(sql`${table.nextAttemptAt} IS NOT NULL`),
]);
