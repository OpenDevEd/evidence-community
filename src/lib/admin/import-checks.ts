import { itemFileDraft } from "@opendeved/evidence-library-core";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";

import type { Database } from "@/db";
import { itemImportCheck } from "@/db/schema/pdf-import";
import { itemFileRemoval } from "@/db/schema/review";
import { itemFilePublication } from "@/db/schema/source";

import type { PdfReading } from "./item-import-contract";
import type { AdminItemChecks } from "./types";

/**
 * Keeps the checks a PDF import read a PDF against with the upload it gave the
 * record: the attachment and the private object of that upload. A retried
 * attachment replaces what an earlier try kept.
 */
export async function keepImportChecks(db: Database, upload: { attachmentKey: string; filename: string; objectPath: string; parentKey: string; reading: PdfReading }) {
	const { checks, sha256, suggestions } = upload.reading;
	if (!checks.length) return;
	const values = { checks, filename: upload.filename, objectPath: upload.objectPath, parentKey: upload.parentKey, sha256, suggestions: suggestions.map(({ checks, field, value }) => ({ checks, field, value })) };
	await db
		.insert(itemImportCheck)
		.values({ attachmentKey: upload.attachmentKey, ...values })
		.onConflictDoUpdate({ set: { ...values, readAt: new Date() }, target: itemImportCheck.attachmentKey });
}

/**
 * The checks a record's PDF was read against when a PDF import made it, while
 * the record's PDF is still that upload: its draft upload, or, with none, the
 * upload its published copy was made from. A record opened as its PDF shows
 * them too. Nothing once the PDF is replaced or being removed.
 */
export async function importChecksOf(db: Database, itemKey: string): Promise<AdminItemChecks | null> {
	const [kept] = await db
		.select({ checks: itemImportCheck.checks, filename: itemImportCheck.filename, readAt: itemImportCheck.readAt, suggestions: itemImportCheck.suggestions })
		.from(itemImportCheck)
		.leftJoin(itemFileDraft, eq(itemFileDraft.itemKey, itemImportCheck.attachmentKey))
		.leftJoin(itemFilePublication, eq(itemFilePublication.itemKey, itemImportCheck.attachmentKey))
		.leftJoin(itemFileRemoval, eq(itemFileRemoval.itemKey, itemImportCheck.attachmentKey))
		.where(
			and(
				or(eq(itemImportCheck.parentKey, itemKey), eq(itemImportCheck.attachmentKey, itemKey)),
				sql`coalesce(${itemFileDraft.objectPath}, ${itemFilePublication.sourceObjectPath}) = ${itemImportCheck.objectPath}`,
				isNull(itemFileRemoval.itemKey),
			),
		)
		.orderBy(desc(itemImportCheck.readAt))
		.limit(1);
	return kept ? { checks: kept.checks, filename: kept.filename, readAt: kept.readAt.toISOString(), suggestions: kept.suggestions } : null;
}
