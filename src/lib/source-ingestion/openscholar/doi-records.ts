import { itemIdentity, itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, like, ne, notLike } from "drizzle-orm";

import type { SourceAdapterContext } from "../adapter";
import type { JsonValue } from "../batch-schema";
import { inUnchangedSource, withdrawSourceRecords } from "../openalex/reconciliation";
import { openAlexItemKeys } from "../openalex/references";
import { writeSourceIngestionBatch } from "../transactional-writer";
import type { OpenscholarReport } from "@/lib/openscholar-service";
import { PDF_RECORD } from "./report-record";
import { asRead, keepReports } from "./report-records";

/** A collection paper's record made from its DOI, under this key, until OpenAlex has its work. */
const DOI_RECORD = "doi:";

/** DOIs one sync looks up through the DOI lookup at most; others wait for a later sync. */
const LOOKUPS_PER_SYNC = 50;

export type RecordByDoi = (doi: string) => Promise<Record<string, unknown> | null>;

/** The source's records made from a DOI, by their DOI. */
export async function doiRecordsOf(context: SourceAdapterContext) {
	const rows = await context.database
		.select({ itemKey: itemSourceLink.itemKey, recordKey: itemSourceLink.sourceRecordKey })
		.from(itemSourceLink)
		// A report's PDF is its report's, not a paper of its own.
		.where(and(eq(itemSourceLink.sourceConnectionKey, context.sourceConnection.key), like(itemSourceLink.sourceRecordKey, `${DOI_RECORD}%`), notLike(itemSourceLink.sourceRecordKey, `${PDF_RECORD}%`), eq(itemSourceLink.remoteDeleted, false)));
	return new Map(rows.map((row) => [row.recordKey.slice(DOI_RECORD.length), row.itemKey]));
}

/**
 * DOIs whose record became its work's: it keeps the identity it was made under, so it isn't made again if OpenAlex
 * loses the work; it's listed instead. One withdrawn while still on its DOI is made again when its DOI comes back.
 */
async function becameWorks(context: SourceAdapterContext) {
	// Through the source's own links: a paper two collections share has the identity the first one made.
	const rows = await context.database
		.select({ recordKey: itemIdentity.sourceRecordKey })
		.from(itemSourceLink)
		.innerJoin(itemIdentity, eq(itemIdentity.key, itemSourceLink.itemKey))
		.where(and(eq(itemSourceLink.sourceConnectionKey, context.sourceConnection.key), like(itemIdentity.sourceRecordKey, `${DOI_RECORD}%`), ne(itemSourceLink.sourceRecordKey, itemIdentity.sourceRecordKey)));
	return new Set(rows.map((row) => row.recordKey!.slice(DOI_RECORD.length)));
}

/**
 * Makes each record made from a DOI the work OpenAlex now has for it, so the scan keeps it up to date from OpenAlex. A
 * work another record already is stays that record's: this one is returned to withdraw.
 */
async function linkResolved(context: SourceAdapterContext, records: ReadonlyMap<string, string>, works: ReadonlyMap<string, string>) {
	const found = [...records].flatMap(([doi, itemKey]) => (works.has(doi) ? [{ itemKey, work: works.get(doi)! }] : []));
	if (!found.length) return [];
	return inUnchangedSource(context.database, asRead(context), async (transaction) => {
		const held = await openAlexItemKeys(transaction, found.map((paper) => paper.work));
		const repeats: string[] = [];
		for (const { itemKey, work } of found) {
			if ((held.get(work) ?? itemKey) !== itemKey) {
				repeats.push(itemKey);
				continue;
			}
			await transaction
				.update(itemSourceLink)
				.set({ sourceRecordKey: work })
				.where(and(eq(itemSourceLink.itemKey, itemKey), eq(itemSourceLink.sourceConnectionKey, context.sourceConnection.key)));
			// Two DOIs can name one work: the next record that names it is a repeat of this one.
			held.set(work, itemKey);
		}
		return repeats;
	});
}

/** A few of these DOIs, chosen anew each sync, so ones that keep failing don't hold the rest back. */
function someOf(dois: readonly string[]) {
	const shuffled = [...dois];
	for (let at = shuffled.length - 1; at > 0; at--) {
		const other = Math.floor(Math.random() * (at + 1));
		[shuffled[at], shuffled[other]] = [shuffled[other]!, shuffled[at]!];
	}
	return shuffled.slice(0, LOOKUPS_PER_SYNC);
}

/** Looks DOIs up one at a time; one the lookup can't read now is looked for again later. */
async function lookUp(dois: readonly string[], recordByDoi: RecordByDoi) {
	const found: { doi: string; payload: Record<string, unknown> }[] = [];
	for (const doi of someOf(dois)) {
		const record = await recordByDoi(doi).catch((error: unknown) => {
			console.error("[collection source] DOI lookup failed", { doi, error: String(error) });
			return null;
		});
		// Its collections are the batch's to say, not the record's.
		if (record) {
			const { collections: _collections, parentItem: _parentItem, ...payload } = record;
			found.push({ doi, payload });
		}
	}
	return found;
}

/**
 * The collection's papers OpenAlex doesn't have, made from their DOI as Added papers makes them (OpenDevEd/new-el#775):
 * each is a record of the collection's source under `doi:<doi>`, which the OpenAlex scan leaves alone. Once OpenAlex has
 * the work, the record becomes the work's. One whose DOI left the collection is withdrawn as a scan withdraws a work,
 * so an edited one stays. Returns the DOIs that have a record now, which aren't listed as missing.
 */
export async function syncDoiRecords(
	context: SourceAdapterContext,
	{ dois, works, recordByDoi, reports = new Map() }: {
		dois: readonly string[];
		works: ReadonlyMap<string, string>;
		recordByDoi?: RecordByDoi;
		/** The Openscholar Reports among the DOIs: their records are Openscholar's, kept by `keepReports`, never OpenAlex's or the lookup's. */
		reports?: ReadonlyMap<string, OpenscholarReport>;
	},
) {
	const records = await doiRecordsOf(context);
	// A withdrawn report has left the collection as far as the library goes: its record is withdrawn with a reason of its own.
	const inCollection = new Set(dois.filter((doi) => reports.get(doi)?.state !== "withdrawn"));
	await keepReports(context, [...reports].map(([doi, report]) => ({ recordKey: `${DOI_RECORD}${doi}`, itemKey: records.get(doi), report })));
	for (const [doi, report] of reports) if (report.state === "withdrawn") records.delete(doi);
	const repeats = await linkResolved(context, records, works);
	const left = [...records].flatMap(([doi, itemKey]) => (!inCollection.has(doi) && !works.has(doi) ? [itemKey] : []));
	await withdrawSourceRecords(context.database, asRead(context), [...repeats, ...left], "This edited record is no longer in the connected Openscholar collection.");
	const before = recordByDoi ? await becameWorks(context) : new Set<string>();
	const looked = recordByDoi ? await lookUp(dois.filter((doi) => !works.has(doi) && !records.has(doi) && !before.has(doi) && !reports.has(doi)), recordByDoi) : [];
	if (looked.length) {
		const cursor = asRead(context).cursor;
		await writeSourceIngestionBatch(context.database, {
			sourceConnectionKey: context.sourceConnection.key,
			expectedConfiguration: context.sourceConnection.config,
			// The scan's cursor stays as it is: these records are outside it.
			expectedCursor: cursor,
			nextCursor: cursor,
			mappingProfileVersion: "doi-v1",
			sourceSyncRunId: context.run?.id,
			fetchedAt: new Date(),
			items: looked.map(({ doi, payload }) => ({ operation: "upsert" as const, sourceRecordKey: `${DOI_RECORD}${doi}`, raw: payload, metadata: payload })),
			collections: [],
		});
	}
	const kept = [...records.keys()].filter((doi) => inCollection.has(doi) && !works.has(doi));
	// A report is accounted for, live or withdrawn: it is never listed as a paper nothing finds.
	return new Set([...kept, ...looked.map(({ doi }) => doi), ...reports.keys()]);
}

/** Withdraws every record the source made from a DOI, as when the library loses the collection. */
export async function withdrawDoiRecords(context: SourceAdapterContext) {
	await syncDoiRecords(context, { dois: [], works: new Map() });
}
