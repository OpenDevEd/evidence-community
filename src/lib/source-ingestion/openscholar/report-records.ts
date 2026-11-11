import { itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import { item } from "@/db/schema/tables/item";
import { itemFieldOverride } from "@/db/schema/topics";
import { unpublishNativeItemWithOutcome } from "@/lib/admin/native-item-service";
import type { OpenscholarReport } from "@/lib/openscholar-service";

import type { SourceAdapterContext } from "../adapter";
import type { JsonValue } from "../batch-schema";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";

import { itemUpsertSchema } from "../batch-schema";
import { withdrawSourceRecords } from "../openalex/reconciliation";
import type { OpenAlexSourceOptions } from "../openalex/sync";
import { writeSourceIngestionBatch } from "../transactional-writer";
import { reportPdfRecordKey, reportSourceItems } from "./report-record";

/** The source's configuration and cursor as this sync read them: a change it writes holds only while they stand. */
export const asRead = (context: SourceAdapterContext) => ({
	sourceConnectionKey: context.sourceConnection.key,
	configuration: context.sourceConnection.config as Record<string, unknown>,
	cursor: (context.sourceConnection.syncCursor ?? {}) as Record<string, JsonValue>,
	sourceSyncRunId: context.run?.id,
});

/** A report this source holds or is about to: the key its record has in the source, and its record once it has one. */
export type HeldReport = { recordKey: string; itemKey?: string; report: OpenscholarReport };


/**
 * Keeps a source's Openscholar Reports as Openscholar has them now (OpenDevEd/new-el#814). A live report is written as
 * its record, with its PDF hosted here as an OpenAlex work's is, cover and full text included: one already held and
 * unchanged costs nothing, and a corrected one replaces what was held. A PDF that can't be had yet stays linked from
 * Openscholar, with an issue that says why, and is tried again on the next sync. A withdrawn report's record is
 * withdrawn as a scan withdraws a work, so an edited one stays with an issue that says why, and its hosted PDF is
 * deleted: Openscholar took it down.
 */
export async function keepReports(context: SourceAdapterContext, held: readonly HeldReport[], options: OpenAlexSourceOptions) {
	if (!held.length) return;
	// The PDF stage hosts a report's PDF: downloaded from Openscholar once, and kept while its address stays the same.
	// Every runtime gives a source one (runtime.ts).
	const pdfs = options.attachmentProcessor;
	if (!pdfs) throw new Error("A source that holds Openscholar Reports needs the PDF stage to host their PDFs");
	const live = held.filter(({ report }) => report.state === "live");
	// A batch holds 5,000 items, and a report is two with its PDF.
	for (let at = 0; at < live.length; at += REPORTS_PER_BATCH) {
		const items = live.slice(at, at + REPORTS_PER_BATCH).flatMap(({ recordKey, report }) => (report.state === "live" ? reportSourceItems(report, recordKey) : [])).map((record) => itemUpsertSchema.parse(record));
		await mapWithConcurrency(items.flatMap((record, index) => (record.file ? [index] : [])), PDFS_AT_ONCE, async (index) => {
			await context.heartbeat();
			items[index] = await pdfs(items[index]!, context.sourceConnection.key);
		});
		await writeReports(context, items);
	}
	const withdrawn = held.filter(({ report, itemKey }) => report.state === "withdrawn" && itemKey);
	if (withdrawn.length) await withdrawReports(context, withdrawn);
	// Files a write replaced or deleted, and ones staged for a write that failed.
	if (live.length || withdrawn.length) await pdfs.flushCleanup(context.sourceConnection.key);
}

/** Reports' PDFs downloaded at once: they all come from Openscholar. */
const PDFS_AT_ONCE = 4;

async function writeReports(context: SourceAdapterContext, items: readonly unknown[]) {
	const { cursor } = asRead(context);
	await writeSourceIngestionBatch(context.database, {
		sourceConnectionKey: context.sourceConnection.key,
		expectedConfiguration: context.sourceConnection.config,
		// The source's own cursor stays as it is: these records are outside its scan.
		expectedCursor: cursor,
		nextCursor: cursor,
		mappingProfileVersion: "openscholar-report-v1",
		sourceSyncRunId: context.run?.id,
		fetchedAt: new Date(),
		items,
		collections: [],
	});
}

async function withdrawReports(context: SourceAdapterContext, withdrawn: readonly HeldReport[]) {
	// A withdrawn report's PDF is deleted with the file it holds here, which is public: a reinstatement downloads it again.
	// With no version, so a reinstatement is never taken for an older copy.
	await writeReports(context, withdrawn.map(({ report }) => ({ operation: "delete", sourceRecordKey: reportPdfRecordKey(report.doi), remoteVersion: null })));
	const pdfs = await reportPdfItems(context, withdrawn.map(({ report }) => report.doi));
	const keys = [...withdrawn.map(({ itemKey }) => itemKey!), ...pdfs];
	await withdrawSourceRecords(context.database, asRead(context), keys, "This edited record's report was withdrawn on Openscholar.");
	// A scan's withdrawal leaves an edited record public, and one another source still holds. A report withdrawn on
	// Openscholar is public nowhere: what is still live is unpublished, which keeps the team's edits out of sight
	// with the record, for an editor to restore if the report is reinstated.
	const stillPublic = await context.database.select({ key: item.key }).from(item).where(and(inArray(item.key, keys), eq(item.deleted, 0)));
	// Attachments first: a record with a public child isn't unpublished.
	const pdfKeys = new Set(pdfs);
	for (const { key } of [...stillPublic].sort((a, b) => Number(pdfKeys.has(b.key)) - Number(pdfKeys.has(a.key)))) {
		await unpublishNativeItemWithOutcome(context.database, key).catch((error: unknown) => {
			console.error("[reports] couldn't unpublish a withdrawn report's record", { itemKey: key, error: String(error) });
		});
	}
	// An unpublish is remembered as the team's own deletion, which a source never undoes. This one is Openscholar's:
	// forgotten here, the record and its PDF come back when the report is reinstated, the team's edits with them.
	// Only for what this withdrawal unpublished: a record or a PDF the team had unpublished itself wasn't public, and
	// keeps its deletion.
	if (stillPublic.length) await context.database.delete(itemFieldOverride).where(and(inArray(itemFieldOverride.itemKey, stillPublic.map(({ key }) => key)), eq(itemFieldOverride.field, "deleted")));
}

/** Live reports one batch writes. */
const REPORTS_PER_BATCH = 2_000;

/** The source's records that are the PDFs of these DOIs' reports: a report's PDF goes when its record does. */
export async function reportPdfItems(context: SourceAdapterContext, dois: readonly string[]) {
	const keys: string[] = [];
	// A statement holds 65,535 parameters.
	for (let at = 0; at < dois.length; at += 10_000) {
		const rows = await context.database
			.select({ itemKey: itemSourceLink.itemKey })
			.from(itemSourceLink)
			.where(and(eq(itemSourceLink.sourceConnectionKey, context.sourceConnection.key), inArray(itemSourceLink.sourceRecordKey, dois.slice(at, at + 10_000).map(reportPdfRecordKey)), eq(itemSourceLink.remoteDeleted, false)));
		keys.push(...rows.map((row) => row.itemKey));
	}
	return keys;
}
