import "server-only";
import { createHash } from "node:crypto";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { LIBRARY_EXPORT_RECORD_CAP } from "@/config/library-config/exports";
import { getDatabaseForConfig } from "@/db";
import { getMeilisearchForConfig } from "./meilisearch";
import { meilisearchIn } from "./meilisearch-filter";
import { readReaderListKeys, readReaderListRevision } from "./readers/data";
import { getSignedInReader } from "./readers/session";
import { resolveSearchQuery } from "./search-query";
import type { LibrarySearchContext } from "./search-context";
import { resolveSearchRequest, resolveSearchTopicNodes } from "./search";
import { readCitationRecordsByKeys, readPublicLibraryKeys } from "./library-export-records";
import type { CitationRecordReader } from "./library-exports";
import { exportChanged, exportTooLarge, LibraryExportError, type LibraryExportRequest } from "./library-export-request";

/** Swaps can rename the index; ordinary writes to the statistics cache cannot change its results. */
async function idleSearchRevision(client: Awaited<ReturnType<typeof getMeilisearchForConfig>>["client"], indexUid: string) {
	const revisions = await Promise.all([{ indexUids: [indexUid] }, { types: ["indexSwap" as const] }].map(async filter => {
		const [latest, active] = await Promise.all([
			client.tasks.getTasks({ ...filter, limit: 1 }),
			client.tasks.getTasks({ ...filter, limit: 1, statuses: ["enqueued", "processing"] }),
		]);
		if (active.results.length) throw exportChanged();
		return latest.results[0]?.uid ?? null;
	}));
	return JSON.stringify(revisions);
}

async function prepareReaderList(config: LibraryServerConfig, readerList: LibrarySearchContext["readerList"], request: Request) {
	const checkAborted = () => request.signal.throwIfAborted();
	async function readerState(includeKeys: boolean) {
		checkAborted();
		if (!readerList) return undefined;
		if (!config.features.readerAccounts) throw new LibraryExportError("exportInvalid", "This community has no reader lists.", 400);
		const viewer = await getSignedInReader(request.headers, config);
		const read = includeKeys ? readReaderListKeys : readReaderListRevision;
		const result = await read(await getDatabaseForConfig(config), readerList, viewer?.id ?? null);
		if ("refused" in result) throw new LibraryExportError(result.refused === 403 ? "exportPrivate" : "exportNotFound", result.refused === 403 ? "This collection is private." : "There is no such collection.", result.refused);
		return result;
	}
	const initialReader = await readerState(true);
	const allowedKeys = initialReader && "keys" in initialReader ? initialReader.keys.sort() : undefined;
	const readerRevision = allowedKeys ? createHash("sha256").update(allowedKeys.join(",")).digest("hex") : undefined;
	async function checkReader() {
		const current = await readerState(false);
		if (current && "revision" in current && current.revision !== readerRevision) throw exportChanged();
	}
	return { allowedKeys, checkReader };
}

/** `count` of a search's keys from `offset` (from 0), in its order. */
async function collectSearchKeys(index: Awaited<ReturnType<typeof getMeilisearchForConfig>>["index"], query: ReturnType<typeof resolveSearchRequest>, filter: string[], signal: AbortSignal, { offset = 0, count = LIBRARY_EXPORT_RECORD_CAP + 1 } = {}) {
	const keys: string[] = [];
	const seen = new Set<string>();
	while (keys.length < count) {
		signal.throwIfAborted();
		const limit = Math.min(500, count - keys.length);
		const page = await index.search<{ key: string }>(query.search, {
			offset: offset + keys.length, limit, attributesToRetrieve: ["key"], attributesToSearchOn: query.attributesToSearchOn,
			...(query.sortOption ? { sort: query.sortOption } : {}), filter,
		});
		for (const hit of page.hits) {
			if (typeof hit.key !== "string" || seen.has(hit.key)) throw exportChanged();
			seen.add(hit.key);
			keys.push(hit.key);
		}
		if (page.hits.length < limit) break;
	}
	return keys;
}

/**
 * A search's record keys in its order, read while the index holds still: at most one past the export cap, or with
 * `range` the `count` from `offset` (from 0) and how many the search finds in all.
 */
export async function readSearchKeys(config: LibraryServerConfig, context: LibrarySearchContext, allowedKeys: string[] | undefined, signal: AbortSignal, range?: { offset: number; count: number }) {
	const { issues } = resolveSearchQuery(context, config);
	if (issues.length) throw new LibraryExportError("exportInvalid", issues.map(issue => issue.message).join(" "), 400);
	if (allowedKeys?.length === 0) return { keys: [], total: 0 };
	const { client, index } = await getMeilisearchForConfig(config);
	const revision = await idleSearchRevision(client, index.uid);
	const settings = await index.getSettings();
	if ((settings.pagination?.maxTotalHits ?? 1000) <= LIBRARY_EXPORT_RECORD_CAP) throw new LibraryExportError("exportChanged", "The search index is not ready for complete exports.");
	const topics = await resolveSearchTopicNodes(context, config);
	const query = resolveSearchRequest(context, config, topics);
	const filter = [...query.finalFilters, ...(allowedKeys ? [meilisearchIn("key", allowedKeys)] : [])];
	const keys = await collectSearchKeys(index, query, filter, signal, range);
	const total = range ? ((await index.search(query.search, { page: 1, hitsPerPage: 0, attributesToSearchOn: query.attributesToSearchOn, filter })).totalHits ?? 0) : keys.length;
	if (await idleSearchRevision(client, index.uid) !== revision) throw exportChanged();
	return { keys, total };
}

function createRecordReader(config: LibraryServerConfig, keys: string[], checkReader: () => Promise<void>): CitationRecordReader {
	const positions = new Map(keys.map((key, index) => [key, index]));
	return async (afterKey, limit) => {
		await checkReader();
		if (afterKey !== null && !positions.has(afterKey)) throw exportChanged();
		const offset = afterKey === null ? 0 : positions.get(afterKey)! + 1;
		const pageKeys = keys.slice(offset, offset + limit);
		const records = await readCitationRecordsByKeys(config, pageKeys);
		if (records.length !== pageKeys.length) throw exportChanged();
		await checkReader();
		return records;
	};
}

export async function prepareLibraryExport(config: LibraryServerConfig, selection: LibraryExportRequest, request: Request) {
	const readerList = selection.scope === "results" ? selection.context.readerList : null;
	const { allowedKeys, checkReader } = await prepareReaderList(config, readerList, request);
	const keys = selection.scope === "library"
		? await readPublicLibraryKeys(config, LIBRARY_EXPORT_RECORD_CAP + 1)
		: (await readSearchKeys(config, selection.context, allowedKeys, request.signal)).keys;
	if (keys.length > LIBRARY_EXPORT_RECORD_CAP) throw exportTooLarge();
	if (selection.expectedCount !== undefined && keys.length !== selection.expectedCount) throw exportChanged();
	await checkReader();
	return { count: keys.length, readPage: createRecordReader(config, keys, checkReader) };
}
