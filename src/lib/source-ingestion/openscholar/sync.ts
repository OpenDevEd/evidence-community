import { OpenScholarServiceError, type OpenScholarService } from "@/lib/openscholar-service";

import type { SourceAdapterContext, SourceSyncResult } from "../adapter";
import { saveSourceDisplayName } from "../display-name";
import { and, eq, notInArray, sql } from "drizzle-orm";
import { sourceRecordIssue } from "@opendeved/evidence-library-core";

import { workIdOf } from "@/lib/admin/added-papers-service";

import { OPENALEX_MAX_IDS_PER_FILTER, OpenAlexClient } from "../openalex/client";
import { openAlexIdStream } from "../openalex/id-stream";
import { openAlexWorksConfigSchema } from "../openalex/schema";
import {
	openAlexWorksAreDue,
	savedOpenAlexWorksVersion,
	syncOpenAlexWorks,
	withdrawOpenAlexWorks,
	type OpenAlexSourceOptions,
} from "../openalex/sync";
import { OpenScholarCollectionGoneError, readOpenScholarCollection } from "./client";

export type OpenScholarSourceOptions = OpenAlexSourceOptions & { service: OpenScholarService };

function goneCode(error: unknown) {
	if (!(error instanceof OpenScholarServiceError)) return null;
	if (error.code === "owner_left") return "owner_left" as const;
	return error.code === "collection_not_found" ? ("not_found" as const) : null;
}

/**
 * Follows one OpenScholar collection. Every sweep asks whether it changed,
 * which costs one small request; a change imports it again, and a collection
 * the library lost access to has its works withdrawn.
 */
export async function syncOpenScholarCollection(
	context: SourceAdapterContext,
	options: OpenScholarSourceOptions,
): Promise<SourceSyncResult> {
	const connection = context.sourceConnection;
	const config = openAlexWorksConfigSchema.parse(connection.config);
	const collectionId = connection.externalScopeKey!;
	const read = async (knownVersion: string | null) => {
		try {
			return await readOpenScholarCollection(options.service, collectionId, knownVersion, { fetch: options.fetch });
		} catch (error) {
			const gone = goneCode(error);
			if (!gone) throw error;
			await withdrawOpenAlexWorks(context);
			throw new OpenScholarCollectionGoneError(gone, collectionId);
		}
	};
	let collection = await read(savedOpenAlexWorksVersion(connection.syncCursor));
	await saveSourceDisplayName(context.database, connection, async () => collection.name);
	if (collection.unchanged) {
		const due = openAlexWorksAreDue(connection.syncCursor, { version: collection.version, downloadPdfs: config.downloadPdfs }, new Date());
		if (!due) return { unchanged: true, version: collection.version };
		collection = await read(null);
		if (collection.unchanged) throw new Error(`Openscholar collection ${collectionId} answered without its items`);
	}
	// A paper with only a DOI is found on OpenAlex by it; the ones OpenAlex doesn't have are listed as issues.
	const byDoi = await worksForDois(context, collection.dois, options);
	await listMissing(context, collection.dois.filter((doi) => !byDoi.has(doi)));
	const ids = [...new Set([...collection.openAlexIds, ...byDoi.values()])].sort();
	const result = await syncOpenAlexWorks(context, openAlexIdStream(ids, collection.version, config.downloadPdfs), options);
	return { ...result, unresolved: collection.unresolved + collection.dois.length - byDoi.size };
}

/** The OpenAlex works these DOIs name, by DOI: those OpenAlex has. */
async function worksForDois(context: SourceAdapterContext, dois: readonly string[], options: OpenScholarSourceOptions) {
	const found = new Map<string, string>();
	const apiKey = await context.credentialResolver?.(context.sourceConnection.key);
	// Without a key the works can't be read either: the sync that follows says so.
	if (!dois.length || !apiKey) return found;
	const client = new OpenAlexClient({ apiKey, fetch: options.fetch, sleep: options.sleep });
	for (let at = 0; at < dois.length; at += OPENALEX_MAX_IDS_PER_FILTER) {
		const works = await client.worksByDoi(dois.slice(at, at + OPENALEX_MAX_IDS_PER_FILTER));
		for (const [doi, work] of works) found.set(doi, workIdOf(work) ?? "");
	}
	return new Map([...found].filter(([, id]) => id));
}

/**
 * Lists on the source's report each DOI OpenAlex doesn't have yet, and clears the ones it found since or that left the
 * collection. Each sync looks for them again.
 */
async function listMissing(context: SourceAdapterContext, dois: readonly string[]) {
	const key = context.sourceConnection.key;
	const keys = dois.map((doi) => `doi:${doi}`);
	await context.database.transaction(async (transaction) => {
		await transaction
			.delete(sourceRecordIssue)
			.where(and(eq(sourceRecordIssue.sourceConnectionKey, key), eq(sourceRecordIssue.code, MISSING_CODE), keys.length ? notInArray(sourceRecordIssue.sourceRecordKey, keys) : sql`true`));
		if (!keys.length) return;
		const now = new Date();
		await transaction
			.insert(sourceRecordIssue)
			.values(dois.map((doi) => ({ sourceConnectionKey: key, sourceRecordKey: `doi:${doi}`, code: MISSING_CODE, message: `OpenAlex doesn't have ${doi} yet, so it isn't in the library. Each sync looks for it again.`, createdAt: now, updatedAt: now })))
			.onConflictDoNothing();
	});
}

/** The issue code of a collection paper OpenAlex doesn't have. */
const MISSING_CODE = "doi_not_on_openalex";
