import "server-only";

import type { LibraryServerConfig } from "@/config/library-config/schema";
import { LIBRARY_EXPORT_RECORD_CAP } from "@/config/library-config/exports";
import { getDatabaseForConfig } from "@/db";
import { getMeilisearchForConfig } from "./meilisearch";
import { meilisearchIn } from "./meilisearch-filter";
import { readReaderListKeys } from "./readers/data";
import { getSignedInReader } from "./readers/session";
import { resolveSearchQuery } from "./search-query";
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

export async function prepareLibraryExport(config: LibraryServerConfig, selection: LibraryExportRequest, request: Request) {
	const checkAborted = () => request.signal.throwIfAborted();
	const readerList = selection.scope === "results" ? selection.context.readerList : null;
	async function readerKeys() {
		checkAborted();
		if (!readerList) return undefined;
		if (!config.features.readerAccounts) throw new LibraryExportError("exportInvalid", "This library has no reader lists.", 400);
		const viewer = await getSignedInReader(request.headers, config);
		const result = await readReaderListKeys(await getDatabaseForConfig(config), readerList, viewer?.id ?? null);
		if ("refused" in result) throw new LibraryExportError(result.refused === 403 ? "exportPrivate" : "exportNotFound", result.refused === 403 ? "This collection is private." : "There is no such collection.", result.refused);
		return result.keys.sort();
	}
	const allowedKeys = await readerKeys();
	const readerRevision = JSON.stringify(allowedKeys);
	async function checkReader() {
		if (JSON.stringify(await readerKeys()) !== readerRevision) throw exportChanged();
	}
	let keys: string[];
	if (selection.scope === "library") {
		keys = await readPublicLibraryKeys(config, LIBRARY_EXPORT_RECORD_CAP + 1);
	} else {
		const { context } = selection;
		const { issues } = resolveSearchQuery(context, config);
		if (issues.length) throw new LibraryExportError("exportInvalid", issues.map(issue => issue.message).join(" "), 400);
		keys = [];
		if (allowedKeys?.length !== 0) {
			const { client, index } = await getMeilisearchForConfig(config);
			const revision = await idleSearchRevision(client, index.uid);
			const settings = await index.getSettings();
			if ((settings.pagination?.maxTotalHits ?? 1000) <= LIBRARY_EXPORT_RECORD_CAP) throw new LibraryExportError("exportChanged", "The search index is not ready for complete exports.");
			const topics = await resolveSearchTopicNodes(context, config);
			const query = resolveSearchRequest(context, config, topics);
			const seen = new Set<string>();
			while (keys.length <= LIBRARY_EXPORT_RECORD_CAP) {
				checkAborted();
				const limit = Math.min(500, LIBRARY_EXPORT_RECORD_CAP + 1 - keys.length);
				const page = await index.search<{ key: string }>(query.search, {
					offset: keys.length, limit, attributesToRetrieve: ["key"], attributesToSearchOn: query.attributesToSearchOn,
					...(query.sortOption ? { sort: query.sortOption } : {}),
					filter: [...query.finalFilters, ...(allowedKeys ? [meilisearchIn("key", allowedKeys)] : [])],
				});
				for (const hit of page.hits) {
					if (typeof hit.key !== "string" || seen.has(hit.key)) throw exportChanged();
					seen.add(hit.key);
					keys.push(hit.key);
				}
				if (page.hits.length < limit) break;
			}
			if (await idleSearchRevision(client, index.uid) !== revision) throw exportChanged();
		}
	}
	if (keys.length > LIBRARY_EXPORT_RECORD_CAP) throw exportTooLarge();
	if (selection.expectedCount !== undefined && keys.length !== selection.expectedCount) throw exportChanged();
	await checkReader();
	const positions = new Map(keys.map((key, index) => [key, index]));
	const readPage: CitationRecordReader = async (afterKey, limit) => {
		await checkReader();
		if (afterKey !== null && !positions.has(afterKey)) throw exportChanged();
		const offset = afterKey === null ? 0 : positions.get(afterKey)! + 1;
		const pageKeys = keys.slice(offset, offset + limit);
		const records = await readCitationRecordsByKeys(config, pageKeys);
		if (records.length !== pageKeys.length) throw exportChanged();
		await checkReader();
		return records;
	};
	return { count: keys.length, readPage };
}
