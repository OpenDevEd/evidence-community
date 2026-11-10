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
	const items = held.flatMap(({ recordKey, report }) => (report.state === "live" ? reportSourceItems(report, recordKey) : []));
	if (items.length) {
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
	const pdfs = await context.database
		.select({ itemKey: itemSourceLink.itemKey })
		.from(itemSourceLink)
		.where(and(eq(itemSourceLink.sourceConnectionKey, context.sourceConnection.key), inArray(itemSourceLink.sourceRecordKey, withdrawn.map(({ report }) => reportPdfRecordKey(report.doi))), eq(itemSourceLink.remoteDeleted, false)));
	await withdrawSourceRecords(context.database, asRead(context), [...withdrawn.map(({ itemKey }) => itemKey!), ...pdfs.map((pdf) => pdf.itemKey)], "This edited record's report was withdrawn on Openscholar.");
}
