import { importPayloadFromZoteroItem } from "@/lib/admin/item-import-service";
import { reportZoteroItem } from "@/lib/openscholar-report";
import type { LiveOpenscholarReport } from "@/lib/openscholar-service";

import type { JsonValue } from "../batch-schema";

/** A live report as a record's payload, as a DOI lookup's item becomes one. */
export const reportPayload = (report: LiveOpenscholarReport) => importPayloadFromZoteroItem(reportZoteroItem(report));

/**
 * The source record a report's PDF is, under its report's: the file stays on Openscholar, at an address that lasts.
 * Its key starts as a DOI record's does, so an OpenAlex scan leaves it alone as it leaves those; no DOI starts "pdf:",
 * so it is never read as one.
 */
export const PDF_RECORD = "doi:pdf:";
export const reportPdfRecordKey = (doi: string) => `${PDF_RECORD}${doi}`;

/**
 * A report's record and its PDF as a source writes them: the record under `recordKey`, the PDF linked from
 * Openscholar. `version` is when the report's details were last set, so a corrected report replaces the one held.
 */
export function reportSourceItems(report: LiveOpenscholarReport, recordKey: string) {
	const { collections: _collections, parentItem: _parentItem, ...payload } = reportPayload(report) as Record<string, JsonValue>;
	const modifiedAt = new Date(report.version);
	const record = {
		operation: "upsert" as const,
		sourceRecordKey: recordKey,
		remoteVersion: report.version,
		raw: { ...report } as Record<string, JsonValue>,
		metadata: payload,
		sourceDates: Number.isNaN(modifiedAt.getTime()) ? null : { addedAt: null, modifiedAt },
	};
	if (!report.pdfUrl) return [record];
	const filename = `${report.key}.pdf`;
	return [
		record,
		{
			operation: "upsert" as const,
			sourceRecordKey: reportPdfRecordKey(report.doi),
			remoteVersion: report.version,
			raw: { openscholarReport: report.key, doi: report.doi, url: report.pdfUrl },
			metadata: { itemType: "Attachment", title: filename, url: report.pdfUrl, tags: [] },
			parentSourceRecordKey: recordKey,
			file: { url: report.pdfUrl, contentType: "application/pdf", filename, linkMode: "linked_url" },
		},
	];
}
