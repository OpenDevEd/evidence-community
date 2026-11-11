import { itemSourceLink } from "@opendeved/evidence-library-core";
import { and, eq, inArray, like, notExists, sql } from "drizzle-orm";

import { itemFilePublication, sourceFileCleanup } from "@/db/schema/source";
import { item } from "@/db/schema/tables/item";
import { itemFieldOverride } from "@/db/schema/topics";
import { NATIVE_SOURCE_CONNECTION_KEY } from "@/lib/admin/constants";
import { unpublishNativeItemWithOutcome } from "@/lib/admin/native-item-service";
import { reportsByDoi, type OpenScholarService, type OpenscholarReport } from "@/lib/openscholar-service";

import type { SourceAdapterContext } from "../adapter";
import type { JsonValue } from "../batch-schema";
import { mapWithConcurrency } from "@/lib/map-with-concurrency";

import { itemUpsertSchema } from "../batch-schema";
import { inUnchangedSource, withdrawSourceRecords } from "../openalex/reconciliation";
import { writeChunks, type OpenAlexSourceOptions } from "../openalex/sync";
import { writeSourceIngestionBatch } from "../transactional-writer";
import { PDF_RECORD, reportPdfRecordKey, reportSourceItems } from "./report-record";

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
	try {
		for (let at = 0; at < live.length; at += REPORTS_PER_BATCH) {
			const items = live.slice(at, at + REPORTS_PER_BATCH).flatMap(({ recordKey, report }) => (report.state === "live" ? reportSourceItems(report, recordKey) : [])).map((record) => itemUpsertSchema.parse(record));
			await mapWithConcurrency(items.flatMap((record, index) => (record.file ? [index] : [])), PDFS_AT_ONCE, async (index) => {
				await context.heartbeat();
				items[index] = await pdfs(items[index]!, context.sourceConnection.key);
			});
			// A PDF carries its text, so a batch is split by its size, as a scan's page is.
			for (const chunk of writeChunks(items)) await writeReports(context, chunk);
		}
		const withdrawn = held.filter(({ report, itemKey }) => report.state === "withdrawn" && itemKey);
		if (withdrawn.length) await withdrawReports(context, withdrawn);
		await removeLeftReportFiles(context);
	} finally {
		// Files a write replaced or deleted, and ones staged for a write that failed or never came. Left queued if this
		// fails, for the next sync.
		await pdfs.flushCleanup(context.sourceConnection.key).catch((error: unknown) => {
			console.error("[reports] couldn't clean up report PDFs' files", { sourceConnectionKey: context.sourceConnection.key, error: String(error) });
		});
	}
}

/**
 * Reports this community still shows that no active source follows: a removed source's records stay, and so does one
 * whose only other source let it go. Openscholar is asked about them every sweep, so a report withdrawn there is taken
 * down here with its stored files, as one a source follows is.
 * ponytail: only a withdrawal reaches such a record; a correction does once a source holds it again.
 */
export async function followOrphanedReports(context: SourceAdapterContext, options: OpenAlexSourceOptions & { service?: OpenScholarService }) {
	if (!options.service) return;
	try {
		await takeDownWithdrawnOrphans(context, options.service, options.fetch);
	} finally {
		// Every sweep, so files whose cleanup failed are tried again even once nothing is left to take down.
		await options.attachmentProcessor?.flushCleanup(context.sourceConnection.key).catch((error: unknown) => {
			console.error("[reports] couldn't clean up report PDFs' files", { sourceConnectionKey: context.sourceConnection.key, error: String(error) });
		});
	}
}

/**
 * Takes a withdrawn report's record off the community. Notes the team added under it are unpublished first, which the
 * record's own unpublish requires: a withdrawn report is public nowhere, and the team's additions stay, out of sight,
 * for an editor to restore with it.
 * ponytail: a file the team uploaded under it is unpublished from the admin (it may hold a Zenodo deposit), so it keeps
 * the record up, logged by the caller, until an editor takes it down.
 */
async function unpublishReport(database: SourceAdapterContext["database"], itemKey: string) {
	const added = await database
		.select({ key: item.key })
		.from(item)
		.where(and(eq(item.parentItem, itemKey), eq(item.sourceConnectionKey, NATIVE_SOURCE_CONNECTION_KEY), eq(item.deleted, 0), notExists(database.select({ one: sql`1` }).from(itemFilePublication).where(eq(itemFilePublication.itemKey, item.key)))));
	for (const { key } of added) await unpublishNativeItemWithOutcome(database, key);
	return await unpublishNativeItemWithOutcome(database, itemKey);
}

async function takeDownWithdrawnOrphans(context: SourceAdapterContext, service: OpenScholarService, fetch: typeof globalThis.fetch | undefined) {
	// All of them, a few DOIs a request: a community has few reports no source holds.
	const orphans = await context.database.execute<{ itemKey: string; doi: string }>(sql`
		SELECT DISTINCT i.key AS "itemKey", snapshot.payload ->> 'doi' AS doi
		FROM "item" i JOIN "sourceSnapshot" snapshot ON snapshot."itemKey" = i.key
		WHERE i.deleted = 0 AND snapshot.payload ? 'pageUrl' AND snapshot.payload ->> 'state' = 'live'
			AND NOT EXISTS (SELECT 1 FROM "itemSourceLink" link JOIN "sourceConnection" c ON c.key = link."sourceConnectionKey"
				WHERE link."itemKey" = i.key AND NOT link."remoteDeleted" AND c.status <> 'removed')`);
	if (!orphans.rows.length) return;
	const reports = await reportsByDoi(service, [...new Set(orphans.rows.map((row) => row.doi))], { fetch });
	const withdrawn = orphans.rows.filter((row) => reports.get(row.doi)?.state === "withdrawn").map((row) => row.itemKey);
	if (!withdrawn.length) return;
	// Only the reports' own PDFs: an attachment the team uploaded is the team's, and goes with its record's unpublish.
	const children = await context.database
		.selectDistinct({ key: item.key, parent: item.parentItem, deleted: item.deleted })
		.from(item)
		.innerJoin(itemSourceLink, and(eq(itemSourceLink.itemKey, item.key), like(itemSourceLink.sourceRecordKey, `${PDF_RECORD}%`)))
		.where(inArray(item.parentItem, withdrawn));
	await inUnchangedSource(context.database, asRead(context), (transaction) => removeHostedPdfs(transaction, context.sourceConnection.key, children.map((child) => child.key)));
	const takenDown: string[] = [];
	for (const itemKey of withdrawn) {
		await unpublishReport(context.database, itemKey).then(
			() => takenDown.push(itemKey),
			(error: unknown) => console.error("[reports] couldn't take down a withdrawn report no source follows", { itemKey, error: String(error) }),
		);
	}
	// The unpublish is remembered as the team's own deletion, which no source undoes. This one is Openscholar's: forgotten,
	// so the report comes back if it is reinstated and a source takes it again. Children the team had hidden keep theirs.
	const marked = [...takenDown, ...children.filter((child) => child.deleted === 0 && takenDown.includes(child.parent!)).map((child) => child.key)];
	if (takenDown.length) await context.database.delete(itemFieldOverride).where(and(inArray(itemFieldOverride.itemKey, marked), eq(itemFieldOverride.field, "deleted")));
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
	const pdfs = await reportPdfItems(context, withdrawn.map(({ report }) => report.doi));
	const keys = [...withdrawn.map(({ itemKey }) => itemKey!), ...pdfs];
	// The files go first, refused like the withdrawal if the source changed meanwhile. Should the withdrawal then fail,
	// its records still hold the source's links, so the next sync withdraws them again.
	await inUnchangedSource(context.database, asRead(context), (transaction) => removeHostedPdfs(transaction, context.sourceConnection.key, pdfs));
	await withdrawSourceRecords(context.database, asRead(context), keys, "This edited record's report was withdrawn on Openscholar.");
	// A scan's withdrawal leaves an edited record public, and one another source still holds. A report withdrawn on
	// Openscholar is public nowhere: what is still live is unpublished, which keeps the team's edits out of sight
	// with the record, for an editor to restore if the report is reinstated.
	const stillPublic = await context.database.select({ key: item.key }).from(item).where(and(inArray(item.key, keys), eq(item.deleted, 0)));
	// Attachments first: a record with a public child isn't unpublished.
	const pdfKeys = new Set(pdfs);
	for (const { key } of [...stillPublic].sort((a, b) => Number(pdfKeys.has(b.key)) - Number(pdfKeys.has(a.key)))) {
		await unpublishReport(context.database, key).catch((error: unknown) => {
			console.error("[reports] couldn't unpublish a withdrawn report's record", { itemKey: key, error: String(error) });
		});
	}
	// An unpublish is remembered as the team's own deletion, which a source never undoes. This one is Openscholar's:
	// forgotten here, the record and its PDF come back when the report is reinstated, the team's edits with them.
	// Only for what this withdrawal unpublished: a record or a PDF the team had unpublished itself wasn't public, and
	// keeps its deletion.
	if (stillPublic.length) await context.database.delete(itemFieldOverride).where(and(inArray(itemFieldOverride.itemKey, stillPublic.map(({ key }) => key)), eq(itemFieldOverride.field, "deleted")));
}

/**
 * Deletes the files of every report PDF whose record is deleted here: a report that left the community, by its
 * collection, by Added papers or with its source, takes its public copy with it, since a later withdrawal on Openscholar
 * no longer reaches a community that let it go. Asked every sync, so one that stopped half way is finished by the next.
 * An OpenAlex work's stored PDF stays for a work that comes back; a report's is downloaded again.
 */
export async function removeLeftReportFiles(context: SourceAdapterContext) {
	await inUnchangedSource(context.database, asRead(context), async (transaction) => {
		const rows = await transaction
			.selectDistinct({ itemKey: item.key })
			.from(item)
			.innerJoin(itemFilePublication, eq(itemFilePublication.itemKey, item.key))
			.innerJoin(itemSourceLink, eq(itemSourceLink.itemKey, item.key))
			.where(and(eq(item.deleted, 1), like(itemSourceLink.sourceRecordKey, `${PDF_RECORD}%`)));
		await removeHostedPdfs(transaction, context.sourceConnection.key, rows.map((row) => row.itemKey));
	});
}

/**
 * Deletes the files a withdrawn report's PDF holds here, whichever source hosted them: they are public, and Openscholar
 * took the report down. A reinstatement downloads the PDF again, since its record no longer has a file.
 */
async function removeHostedPdfs(transaction: Transaction, sourceConnectionKey: string, itemKeys: readonly string[]) {
	if (!itemKeys.length) return;
	const removed = await transaction
		.delete(itemFilePublication)
		.where(inArray(itemFilePublication.itemKey, [...itemKeys]))
		.returning({ objectPath: itemFilePublication.objectPath, coverObjectPath: itemFilePublication.coverObjectPath });
	const now = new Date();
	const paths = removed.flatMap((row) => [row.objectPath, row.coverObjectPath]);
	// Queued under this source, whose cleanup at the end of keepReports removes them.
	if (paths.length) {
		await transaction
			.insert(sourceFileCleanup)
			.values(paths.map((objectPath) => ({ sourceConnectionKey, objectPath, updatedAt: now })))
			.onConflictDoUpdate({ target: [sourceFileCleanup.sourceConnectionKey, sourceFileCleanup.objectPath], set: { attempts: 0, deadLetteredAt: null, lastError: null, updatedAt: now } });
	}
}

type Transaction = Parameters<Parameters<SourceAdapterContext["database"]["transaction"]>[0]>[0];

/** Live reports whose PDFs are processed together before they are written: each holds up to 1.5 MB of text. */
const REPORTS_PER_BATCH = 50;

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
