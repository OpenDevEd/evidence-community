import "server-only";
import { createHash } from "node:crypto";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { LIBRARY_EXPORT_RECORD_CAP } from "@/config/library-config/exports";
import { getDatabaseForConfig } from "@/db";
import type { estypes } from "@elastic/elasticsearch";
import { getSearchForConfig } from "./elasticsearch";
import { fieldIn, searchQuery, sortClauses, type SearchFilter } from "./search-engine";
import { readReaderListKeys, readReaderListRevision } from "./readers/data";
import { getSignedInReader } from "./readers/session";
import { resolveSearchQuery } from "./search-query";
import type { LibrarySearchContext } from "./search-context";
import { resolveSearchRequest, resolveSearchTopicNodes, totalOf } from "./search";
import { readCitationRecordsByKeys, readPublicLibraryKeys } from "./library-export-records";
import type { CitationRecordReader } from "./library-exports";
import { exportChanged, exportTooLarge, LibraryExportError, type LibraryExportRequest } from "./library-export-request";

async function prepareReaderList(config: LibraryServerConfig, readerList: LibrarySearchContext["readerList"], request: Request) {
	const checkAborted = () => request.signal.throwIfAborted();
	async function readerState(includeKeys: boolean) {
		checkAborted();
		if (!readerList) return undefined;
		if (!config.features.readerAccounts) throw new LibraryExportError("exportInvalid", "This library has no reader lists.", 400);
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

/** Keys a page reads at once. */
const KEYS_PER_PAGE = 500;

/**
 * `count` of a search's keys from `offset` (from 0), in its order, and how many the search finds in all, read from
 * one point in time of the index: writes and a rebuild meanwhile don't change what this export reads.
 */
async function collectSearchKeys(config: LibraryServerConfig, query: ReturnType<typeof resolveSearchRequest>, filters: SearchFilter[], signal: AbortSignal, { offset = 0, count = LIBRARY_EXPORT_RECORD_CAP + 1 } = {}) {
	const { alias, client } = await getSearchForConfig(config);
	const pit = await client.openPointInTime({ index: alias, keep_alive: "2m" }, { signal });
	try {
		const keys: string[] = [];
		let total = 0;
		let after: estypes.SortResults | undefined;
		while (keys.length < offset + count) {
			signal.throwIfAborted();
			const size = Math.min(KEYS_PER_PAGE, offset + count - keys.length);
			const response = await client.search<{ key: string }>({
				pit: { id: pit.id, keep_alive: "2m" },
				size,
				query: searchQuery(query.search, query.attributesToSearchOn, filters, query.sortOption),
				sort: sortClauses(query.sortOption, { text: query.search }),
				_source: ["key"],
				track_total_hits: after === undefined,
				...(after ? { search_after: after } : {}),
			}, { signal });
			if (after === undefined) total = totalOf(response);
			keys.push(...response.hits.hits.map((hit) => String(hit._source?.key)));
			if (response.hits.hits.length < size) break;
			after = response.hits.hits.at(-1)!.sort;
		}
		return { keys: keys.slice(offset, offset + count), total };
	} finally {
		await client.closePointInTime({ id: pit.id }).catch(() => undefined);
	}
}

/**
 * A search's record keys in its order, read from one point in time of the index: at most one past the export cap,
 * or with `range` the `count` from `offset` (from 0) and how many the search finds in all.
 */
export async function readSearchKeys(config: LibraryServerConfig, context: LibrarySearchContext, allowedKeys: string[] | undefined, signal: AbortSignal, range?: { offset: number; count: number }) {
	const { issues } = resolveSearchQuery(context, config);
	if (issues.length) throw new LibraryExportError("exportInvalid", issues.map(issue => issue.message).join(" "), 400);
	if (allowedKeys?.length === 0) return { keys: [], total: 0 };
	const topics = await resolveSearchTopicNodes(context, config);
	const query = resolveSearchRequest(context, config, topics);
	const filters = [...query.finalFilters, ...(allowedKeys ? [fieldIn("key", allowedKeys)] : [])];
	const { keys, total } = await collectSearchKeys(config, query, filters, signal, range);
	return { keys, total: range ? total : keys.length };
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
