import { createHash } from "node:crypto";

import { and, asc, eq, isNotNull, isNull, sql } from "drizzle-orm";

import { addedPaper } from "@/db/schema/source";
import { linkAddedPaper } from "@/lib/admin/added-paper-links";

import type { SourceAdapter, SourceAdapterContext, SourceSyncResult } from "../adapter";
import { SourceCredentialNotFoundError } from "../credentials";
import { OPENALEX_MAX_IDS_PER_FILTER, OpenAlexClient } from "../openalex/client";
import { openAlexIdStream } from "../openalex/id-stream";
import { addedPapersConfigSchema } from "../openalex/schema";
import { openAlexWorksAreDue, syncOpenAlexWorks, type OpenAlexSourceOptions } from "../openalex/sync";

const workIdOf = (work: unknown) => String((work as { id?: unknown } | null)?.id ?? "").split("/").pop() ?? "";

/**
 * Looks on OpenAlex again for the accepted papers found only by their DOI, a hundred at a time, and links the ones it
 * has now. Returns how many are still only on their DOI.
 */
async function resolveDoiOnlyPapers(context: SourceAdapterContext, client: OpenAlexClient) {
	const unresolved = await context.database
		.select({ itemKey: addedPaper.itemKey, doi: addedPaper.doi })
		.from(addedPaper)
		.where(and(eq(addedPaper.state, "accepted"), isNull(addedPaper.openalexId), isNotNull(addedPaper.doi)))
		.orderBy(asc(addedPaper.addedAt));
	let left = unresolved.length;
	for (let at = 0; at < unresolved.length; at += OPENALEX_MAX_IDS_PER_FILTER) {
		const part = unresolved.slice(at, at + OPENALEX_MAX_IDS_PER_FILTER);
		const found = await client.worksByDoi(part.map((row) => row.doi!));
		const linked = part.flatMap((row) => {
			const work = found.get(row.doi!);
			return work ? [{ itemKey: row.itemKey, openalexId: workIdOf(work) }] : [];
		});
		if (!linked.length) continue;
		await context.database.transaction(async (transaction) => {
			for (const { itemKey, openalexId } of linked) await linkAddedPaper(transaction, itemKey, openalexId);
		});
		left -= linked.length;
	}
	return left;
}

/**
 * The Added papers source: the accepted papers' OpenAlex works, kept up to date like a collection's. Papers waiting in
 * the review queue aren't linked yet, so a sync never publishes or withdraws them.
 */
export async function syncAddedPapers(context: SourceAdapterContext, options: OpenAlexSourceOptions): Promise<SourceSyncResult> {
	const connection = context.sourceConnection;
	const config = addedPapersConfigSchema.parse(connection.config);
	const [{ count }] = await context.database
		.select({ count: sql<number>`count(*)::int` })
		.from(addedPaper)
		.where(eq(addedPaper.state, "accepted"));
	const synced = Object.keys(connection.syncCursor ?? {}).length > 0;
	// Nothing added yet and nothing to withdraw: no OpenAlex request, so a community without a key isn't refused.
	if (!count && !synced) return { unchanged: true, version: "empty" };
	const apiKey = await context.credentialResolver?.(connection.key);
	if (!apiKey) throw new SourceCredentialNotFoundError(connection.key);
	const unresolved = await resolveDoiOnlyPapers(context, new OpenAlexClient({ apiKey, fetch: options.fetch, sleep: options.sleep }));
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
export function createAddedPapersSourceAdapter(options: OpenAlexSourceOptions): SourceAdapter {
	return { provider: "added", sync: (context) => syncAddedPapers(context, options) };
}
