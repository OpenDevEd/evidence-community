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
	attach: jsonb("attach").$type<Record<string, "attached" | "failed">>().notNull().default({}),
	closedAt: timestamp("closedAt", { withTimezone: true }),
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
	reading: jsonb("reading").$type<PdfReading>(),
	attempts: integer("attempts").notNull().default(0),
	nextAttemptAt: timestamp("nextAttemptAt", { withTimezone: true }),
	leaseToken: text("leaseToken"),
	leaseExpiresAt: timestamp("leaseExpiresAt", { withTimezone: true }),
	lastError: text("lastError"),
}, (table) => [
	uniqueIndex("pdfImportFile_position").on(table.importId, table.position),
	index("pdfImportFile_pending_idx").on(table.nextAttemptAt).where(sql`${table.nextAttemptAt} IS NOT NULL`),
]);
