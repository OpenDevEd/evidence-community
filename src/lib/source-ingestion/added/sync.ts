import { createHash } from "node:crypto";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { addedPaper } from "@/db/schema/source";
import { openAlexItemKeys } from "../openalex/references";
import { linkAddedPaper } from "@/lib/admin/added-paper-links";

import type { SourceAdapter, SourceAdapterContext, SourceSyncResult } from "../adapter";
import { SourceCredentialNotFoundError } from "../credentials";
import { OPENALEX_MAX_IDS_PER_FILTER, OpenAlexClient } from "../openalex/client";
import { openAlexIdStream } from "../openalex/id-stream";
import { addedPapersConfigSchema } from "../openalex/schema";
import { openAlexWorksAreDue, syncOpenAlexWorks, type OpenAlexSourceOptions } from "../openalex/sync";
import { keepReports } from "../openscholar/report-records";
import { itemSourceLink } from "@opendeved/evidence-library-core";
import { reportsByDoi, type OpenScholarService } from "@/lib/openscholar-service";

export type AddedPapersSourceOptions = OpenAlexSourceOptions & {
	/** Openscholar, asked which accepted papers are its reports; without it they are followed like any DOI-only paper. */
	service?: OpenScholarService;
};

/** The accepted papers known only by their DOI, oldest first. */
const doiOnlyPapers = (context: SourceAdapterContext) =>
	context.database
		.select({ itemKey: addedPaper.itemKey, doi: addedPaper.doi })
		.from(addedPaper)
		.where(and(eq(addedPaper.state, "accepted"), isNull(addedPaper.openalexId), isNotNull(addedPaper.doi)))
		.orderBy(asc(addedPaper.addedAt));

/**
 * Keeps the accepted papers that are Openscholar Reports as Openscholar has them now (OpenDevEd/new-el#814): a
 * correction replaces the record, and a withdrawn report is withdrawn. Returns their DOIs, which OpenAlex is never
 * asked about: a report's record stays Openscholar's.
 */
async function followReports(context: SourceAdapterContext, options: AddedPapersSourceOptions) {
	if (!options.service) return new Set<string>();
	const doiOnly = await doiOnlyPapers(context);
	if (!doiOnly.length) return new Set<string>();
	const reports = await reportsByDoi(options.service, [...new Set(doiOnly.map((row) => row.doi!))], { fetch: options.fetch });
	const held = doiOnly.flatMap((row) => (reports.has(row.doi!) ? [{ recordKey: `doi:${row.doi}`, itemKey: row.itemKey, report: reports.get(row.doi!)! }] : []));
	// Accepted, a paper found only by its DOI is linked under its own key. A report's record is written under its DOI,
	// as a collection's is, which a scan of OpenAlex leaves alone.
	for (const { recordKey, itemKey } of held) {
		await context.database
			.update(itemSourceLink)
			.set({ sourceRecordKey: recordKey })
			.where(and(eq(itemSourceLink.itemKey, itemKey), eq(itemSourceLink.sourceConnectionKey, context.sourceConnection.key), eq(itemSourceLink.sourceRecordKey, itemKey)));
	}
	await keepReports(context, held);
	return new Set(reports.keys());
}

const workIdOf = (work: unknown) => String((work as { id?: unknown } | null)?.id ?? "").split("/").pop() ?? "";

/**
 * Looks on OpenAlex again for the accepted papers found only by their DOI, a hundred at a time, and links the ones it
 * has now. Returns how many are still only on their DOI.
 */
async function resolveDoiOnlyPapers(context: SourceAdapterContext, client: OpenAlexClient, reports: ReadonlySet<string>) {
	const unresolved = (await doiOnlyPapers(context)).filter((row) => !reports.has(row.doi!));
	let left = unresolved.length;
	for (let at = 0; at < unresolved.length; at += OPENALEX_MAX_IDS_PER_FILTER) {
		const part = unresolved.slice(at, at + OPENALEX_MAX_IDS_PER_FILTER);
		const found = await client.worksByDoi(part.map((row) => row.doi!));
		const linked = part.flatMap((row) => {
			const work = found.get(row.doi!);
			return work ? [{ itemKey: row.itemKey, openalexId: workIdOf(work) }] : [];
		});
		if (!linked.length) continue;
		left -= await context.database.transaction(async (transaction) => {
			// The OpenAlex writer's lock: a work another source brought in meanwhile stays that record's alone, and this
			// one stays on its DOI rather than become the work's second record.
			await transaction.execute(sql`select pg_advisory_xact_lock(hashtext('new-el:openalex-records'))`);
			const held = await openAlexItemKeys(transaction, linked.map((paper) => paper.openalexId));
			const free = linked.filter(({ itemKey, openalexId }) => (held.get(openalexId) ?? itemKey) === itemKey);
			for (const { itemKey, openalexId } of free) await linkAddedPaper(transaction, itemKey, openalexId);
			return free.length;
		});
	}
	return left;
}

/**
 * The Added papers source: the accepted papers' OpenAlex works, kept up to date like a collection's. Papers waiting in
 * the review queue aren't linked yet, so a sync never publishes or withdraws them.
 */
export async function syncAddedPapers(context: SourceAdapterContext, options: AddedPapersSourceOptions): Promise<SourceSyncResult> {
	const connection = context.sourceConnection;
	const config = addedPapersConfigSchema.parse(connection.config);
	const [{ count }] = await context.database
		.select({ count: sql<number>`count(*)::int` })
		.from(addedPaper)
		.where(eq(addedPaper.state, "accepted"));
	const synced = Object.keys(connection.syncCursor ?? {}).length > 0;
	// Nothing added yet and nothing to withdraw: no OpenAlex request, so a community without a key isn't refused.
	if (!count && !synced) return { unchanged: true, version: "empty" };
	// Before the OpenAlex key is asked for: a community's reports are followed without one.
	const reports = await followReports(context, options);
	const apiKey = await context.credentialResolver?.(connection.key);
	if (!apiKey) throw new SourceCredentialNotFoundError(connection.key);
	const unresolved = await resolveDoiOnlyPapers(context, new OpenAlexClient({ apiKey, fetch: options.fetch, sleep: options.sleep }), reports);
	const ids = (
		await context.database
			.select({ openalexId: addedPaper.openalexId })
			.from(addedPaper)
			.where(and(eq(addedPaper.state, "accepted"), isNotNull(addedPaper.openalexId)))
			.orderBy(asc(addedPaper.openalexId))
	).map((row) => row.openalexId!);
	// The list itself is the version: a paper accepted or removed changes it, and the next sweep imports it.
	const version = createHash("sha256").update(ids.join(",")).digest("hex").slice(0, 32);
	if (!openAlexWorksAreDue(connection.syncCursor, { version, downloadPdfs: config.downloadPdfs }, new Date())) {
		return { unchanged: true, version, unresolved };
	}
	const result = await syncOpenAlexWorks(context, openAlexIdStream(ids, version, config.downloadPdfs), options);
	return { ...result, unresolved };
}

/** Runs every sweep: an unchanged list costs one small read, and DOI-only papers are looked for again. */
export function createAddedPapersSourceAdapter(options: AddedPapersSourceOptions): SourceAdapter {
	return { provider: "added", sync: (context) => syncAddedPapers(context, options) };
}
