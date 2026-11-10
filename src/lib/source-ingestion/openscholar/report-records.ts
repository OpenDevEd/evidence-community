import { itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, inArray } from "drizzle-orm";

import type { OpenscholarReport } from "@/lib/openscholar-service";

import type { SourceAdapterContext } from "../adapter";
import type { JsonValue } from "../batch-schema";
import { withdrawSourceRecords } from "../openalex/reconciliation";
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
 * its record, with its PDF linked from Openscholar: one already held and unchanged costs nothing, and a corrected one
 * replaces what was held. A withdrawn report's record is withdrawn as a scan withdraws a work, so an edited one stays
 * with an issue that says why.
 */
export async function keepReports(context: SourceAdapterContext, held: readonly HeldReport[]) {
	const live = held.filter(({ report }) => report.state === "live");
	// A batch holds 5,000 items, and a report is two with its PDF.
	for (let at = 0; at < live.length; at += REPORTS_PER_BATCH) {
		const items = live.slice(at, at + REPORTS_PER_BATCH).flatMap(({ recordKey, report }) => (report.state === "live" ? reportSourceItems(report, recordKey) : []));
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
	const withdrawn = held.filter(({ report, itemKey }) => report.state === "withdrawn" && itemKey);
	if (!withdrawn.length) return;
	const pdfs = await reportPdfItems(context, withdrawn.map(({ report }) => report.doi));
	await withdrawSourceRecords(context.database, asRead(context), [...withdrawn.map(({ itemKey }) => itemKey!), ...pdfs], "This edited record's report was withdrawn on Openscholar.");
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
