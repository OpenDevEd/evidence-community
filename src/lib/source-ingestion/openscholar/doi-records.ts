import { itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, like, sql } from "drizzle-orm";

import type { SourceAdapterContext } from "../adapter";
import type { JsonValue } from "../batch-schema";
import { openAlexItemKeys } from "../openalex/references";
import { writeSourceIngestionBatch } from "../transactional-writer";

/** A collection paper's record made from its DOI, under this key, until OpenAlex has its work. */
const DOI_RECORD = "doi:";

/** DOIs one sync looks up through the DOI lookup at most; the rest wait for the next sync. */
const LOOKUPS_PER_SYNC = 50;

export type RecordByDoi = (doi: string) => Promise<Record<string, unknown> | null>;

/** The source's records made from a DOI, by their DOI. */
async function doiRecordsOf(context: SourceAdapterContext) {
	const rows = await context.database
		.select({ itemKey: itemSourceLink.itemKey, recordKey: itemSourceLink.sourceRecordKey })
		.from(itemSourceLink)
		.where(and(eq(itemSourceLink.sourceConnectionKey, context.sourceConnection.key), like(itemSourceLink.sourceRecordKey, `${DOI_RECORD}%`), eq(itemSourceLink.remoteDeleted, false)));
	return new Map(rows.map((row) => [row.recordKey.slice(DOI_RECORD.length), row.itemKey]));
}

/**
 * Links each record made from a DOI to the work OpenAlex now has for it, under the OpenAlex writer's lock, so the scan
 * keeps it up to date from OpenAlex. A work another record already is stays that record's: this one is withdrawn.
 * Returns the DOIs to withdraw.
 */
async function linkResolved(context: SourceAdapterContext, records: ReadonlyMap<string, string>, resolved: ReadonlyMap<string, string>) {
	const found = [...records].flatMap(([doi, itemKey]) => (resolved.has(doi) ? [{ doi, itemKey, work: resolved.get(doi)! }] : []));
	if (!found.length) return [];
	return context.database.transaction(async (transaction) => {
		await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`);
		const held = await openAlexItemKeys(transaction, found.map((paper) => paper.work));
		const repeats: string[] = [];
		for (const { doi, itemKey, work } of found) {
			if ((held.get(work) ?? itemKey) !== itemKey) {
				repeats.push(doi);
				continue;
			}
			await transaction
				.update(itemSourceLink)
				.set({ sourceRecordKey: work })
				.where(and(eq(itemSourceLink.itemKey, itemKey), eq(itemSourceLink.sourceConnectionKey, context.sourceConnection.key)));
		}
		return repeats;
	});
}

/**
 * The collection's papers OpenAlex doesn't have, made from their DOI as Added papers makes them (OpenDevEd/new-el#775):
 * each is a record of the collection's source under `doi:<doi>`, which the OpenAlex scan leaves alone. Once OpenAlex has
 * the work, the record becomes the work's. One whose DOI left the collection is withdrawn. Returns the DOIs that have a
 * record now, which aren't listed as missing.
 */
export async function syncDoiRecords(
	context: SourceAdapterContext,
	{ dois, resolved, recordByDoi }: { dois: readonly string[]; resolved: ReadonlyMap<string, string>; recordByDoi?: RecordByDoi },
) {
	const records = await doiRecordsOf(context);
	const inCollection = new Set(dois);
	const repeats = await linkResolved(context, records, resolved);
	const left = [...records.keys()].filter((doi) => !inCollection.has(doi) && !resolved.has(doi));
	const looked = recordByDoi ? await lookUp(dois.filter((doi) => !resolved.has(doi) && !records.has(doi)), recordByDoi) : [];
	const withdrawn = [...repeats, ...left];
	if (looked.length || withdrawn.length) {
		const cursor = (context.sourceConnection.syncCursor ?? {}) as Record<string, JsonValue>;
		await writeSourceIngestionBatch(context.database, {
			sourceConnectionKey: context.sourceConnection.key,
			expectedConfiguration: context.sourceConnection.config,
			// The scan's cursor stays as it is: these records are outside it.
			expectedCursor: cursor,
			nextCursor: cursor,
			mappingProfileVersion: "doi-v1",
			fetchedAt: new Date(),
			items: [
				...looked.map(({ doi, payload }) => ({ operation: "upsert" as const, sourceRecordKey: `${DOI_RECORD}${doi}`, raw: payload, metadata: payload })),
				...withdrawn.map((doi) => ({ operation: "delete" as const, sourceRecordKey: `${DOI_RECORD}${doi}` })),
			],
			collections: [],
		});
	}
	const kept = [...records.keys()].filter((doi) => inCollection.has(doi) && !resolved.has(doi));
	return new Set([...kept, ...looked.map(({ doi }) => doi)]);
}

/** Looks DOIs up one at a time, a bounded number a sync; one the lookup can't read is looked for again next time. */
async function lookUp(dois: readonly string[], recordByDoi: RecordByDoi) {
	const found: { doi: string; payload: Record<string, unknown> }[] = [];
	for (const doi of dois.slice(0, LOOKUPS_PER_SYNC)) {
		const payload = await recordByDoi(doi).catch((error: unknown) => {
			console.error("[collection source] DOI lookup failed", { doi, error: String(error) });
			return null;
		});
		if (payload) found.push({ doi, payload });
	}
	return found;
}

/** Withdraws every record the source made from a DOI, as when the library loses the collection. */
export async function withdrawDoiRecords(context: SourceAdapterContext) {
	await syncDoiRecords(context, { dois: [], resolved: new Map() });
}
