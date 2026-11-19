import { itemSourceLink, outbox } from "@opendeved/evidence-library-core";
import { and, eq, inArray, sql } from "drizzle-orm";

import { lockItemMutations } from "@/db/canonical-mutation-lock";
import type { Database } from "@/db/database-schema";
import { itemFilePublication } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { MAX_SOURCE_FULL_TEXT_BYTES, truncateUtf8 } from "@/lib/source-ingestion/attachment-storage";

import type { EvidenceFileStorage } from "./file-storage";
import { processPdfInWorkers } from "./pdf-pool";
import { downloadPublished } from "./withdrawn-path";

// Saved text with fewer letters than this, page markers aside, is read again.
const NEARLY_EMPTY_LETTERS = 100;
// Page markers alone stay under this for a PDF of a few thousand pages.
const NEARLY_EMPTY_MAX_CHARACTERS = 50_000;
// A new reading replaces the saved text only when it finds clearly more.
const MIN_GAIN_LETTERS = 50;

const letters = (text: string | null) => (text?.replace(/\*\*\|\| PAGE \d+ \|\|\*\*/gu, "").match(/\p{L}/gu) ?? []).length;

/**
 * Reads again the published PDFs whose saved text is nearly empty, from the library's own copy, and saves the text
 * when the reader now finds clearly more. A reader fix only reaches new PDFs otherwise: a PDF whose link has not
 * changed keeps the text it was published with. Each changed record and its parent get a new revision for search to
 * reindex, as an admin's file change does; nothing is marked for writing back to a source.
 */
export async function rereadNearlyEmptyPdfText(database: Database, storage: EvidenceFileStorage) {
	const rows = await database
		.select({ key: item.key, parent: item.parentItem, text: item.fullTextPDF, objectPath: itemFilePublication.objectPath })
		.from(itemFilePublication)
		.innerJoin(item, eq(item.key, itemFilePublication.itemKey))
		.where(
			// A text with no words is short even for a long scan (its page markers alone), so only short texts are scanned.
			sql`case when length(coalesce(${item.fullTextPDF}, '')) < ${NEARLY_EMPTY_MAX_CHARACTERS} then length(regexp_replace(coalesce(${item.fullTextPDF}, ''), '\\*\\*\\|\\| PAGE [0-9]+ \\|\\|\\*\\*|[^[:alpha:]]', '', 'g')) < ${NEARLY_EMPTY_LETTERS} else false end`,
		);
	let updated = 0;
	let skipped = 0;
	let failed = 0;
	for (const row of rows) {
		try {
			const processed = await processPdfInWorkers(await downloadPublished(storage, row.objectPath));
			const text = truncateUtf8(processed.text, MAX_SOURCE_FULL_TEXT_BYTES);
			if (letters(text) < letters(row.text) + MIN_GAIN_LETTERS) continue;
			if (await saveText(database, row, text)) updated++;
			else skipped++;
		} catch (error) {
			failed++;
			console.error("Could not read this PDF again", { itemKey: row.key, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return { checked: rows.length, updated, skipped, failed };
}

/**
 * Saves the text, checked again under the records' lock: the PDF may have been replaced or unpublished while it was
 * read, and a record with source changes waiting to be written back keeps its revision, which that writeback needs.
 */
async function saveText(database: Database, row: { key: string; parent: string | null; text: string | null; objectPath: string }, text: string) {
	return database.transaction(async (transaction) => {
		const keys = row.parent ? [row.key, row.parent] : [row.key];
		await lockItemMutations(transaction, keys);
		const [current] = await transaction
			.select({ text: item.fullTextPDF, objectPath: itemFilePublication.objectPath })
			.from(itemFilePublication)
			.innerJoin(item, eq(item.key, itemFilePublication.itemKey))
			.where(eq(item.key, row.key));
		if (!current || current.objectPath !== row.objectPath || current.text !== row.text) return false;
		const [pendingWriteback] = await transaction
			.select({ key: itemSourceLink.itemKey })
			.from(itemSourceLink)
			.where(and(inArray(itemSourceLink.itemKey, keys), sql`jsonb_array_length(${itemSourceLink.dirtyFields}) > 0`))
			.limit(1);
		if (pendingWriteback) return false;
		await transaction.update(item).set({ fullTextPDF: text }).where(eq(item.key, row.key));
		// The outbox holds one event per record revision.
		const bumped = await transaction
			.update(item)
			.set({ revision: sql`${item.revision} + 1` })
			.where(inArray(item.key, keys))
			.returning({ key: item.key, revision: item.revision });
		await transaction.insert(outbox).values(
			bumped.map((entry) => ({ entityType: "item" as const, entityKey: entry.key, operation: "upsert" as const, revision: entry.revision })),
		);
		return true;
	});
}
