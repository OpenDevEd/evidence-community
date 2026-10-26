import { MeilisearchApiError, type SearchParams, type SearchResponse } from "meilisearch";

import type { MeilisearchService } from "@/lib/meilisearch-factory";
import { SearchChangedError, type SearchAnswer, type SearchEngine, type SearchFilter, type SearchRequest } from "@/lib/search-engine";

/** Keys one page of a deep key walk reads at once. */
const KEYS_PER_PAGE = 500;

/** How long the list of a library's stored fields is reused before it is read again. */
const FIELD_LIST_TTL_MS = 60_000;

const FILTER_FIELD = /^[A-Za-z][A-Za-z0-9_.]*$/u;

function filterField(field: string) {
	if (!FILTER_FIELD.test(field)) throw new Error(`Invalid Meilisearch filter field: ${field}`);
	return field;
}

function filterValue(value: string | number | boolean) {
	return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function rangeExpression(field: string, range: { gte?: number; lte?: number }) {
	const bounds = [
		...(range.gte === undefined ? [] : [`${field} >= ${range.gte}`]),
		...(range.lte === undefined ? [] : [`${field} <= ${range.lte}`]),
	];
	return `(${bounds.join(" AND ")})`;
}

/** A filter as a Meilisearch filter expression. */
export function filterExpression(filter: SearchFilter): string {
	if ("any" in filter) return `(${filter.any.map(filterExpression).join(" OR ")})`;
	if ("not" in filter) return `NOT (${filterExpression(filter.not)})`;
	const field = filterField(filter.field);
	if ("equals" in filter) return `${field} = ${filterValue(filter.equals)}`;
	if ("in" in filter) return `${field} IN [${filter.in.map(filterValue).join(",")}]`;
	if ("present" in filter) return `${field} EXISTS`;
	return rangeExpression(field, filter.range);
}

function unseenKey(key: unknown, seen: Set<string>) {
	if (typeof key !== "string" || seen.has(key)) throw new SearchChangedError();
	seen.add(key);
	return key;
}

/** Where a page starts: an offset, the record after or before a place (an offset), or `fromEnd`'s offset. */
function startOf(request: SearchRequest, total?: number) {
	if (request.after) return Number(request.after[0]) + 1;
	if (request.before) return Math.max(0, Number(request.before[0]) - request.size);
	if (request.fromEnd) return Math.max(0, (total ?? 0) - request.size);
	return request.from ?? 0;
}

function answerOf<T>(response: SearchResponse<Record<string, unknown>>, offset: number): SearchAnswer<T> {
	const hits = response.hits as T[];
	return {
		hits,
		total: response.estimatedTotalHits ?? response.totalHits ?? hits.length,
		facets: response.facetDistribution ?? {},
		first: hits.length ? [offset] : null,
		last: hits.length ? [offset + hits.length - 1] : null,
	};
}

/**
 * A library's search in its own Meilisearch, as the library searched before EL-32: Meilisearch ranks the words
 * itself, and pages reach any offset its `maxTotalHits` allows.
 */
export function meilisearchEngine({ client, index, indexName }: MeilisearchService): SearchEngine {
	let fieldList: { at: number; fields: Promise<string[]> } | null = null;

	/** Every stored top-level field; Meilisearch can only name the fields to send back, not leave some out. */
	function storedFields() {
		if (!fieldList || Date.now() - fieldList.at > FIELD_LIST_TTL_MS) {
			const fields = (async () => {
				const displayed = await index.getDisplayedAttributes();
				if (!displayed.includes("*")) return displayed;
				const { fieldDistribution } = await index.getStats();
				return [...new Set(Object.keys(fieldDistribution).map((field) => field.split(".")[0]!))];
			})();
			fieldList = { at: Date.now(), fields };
			fields.catch(() => {
				fieldList = null;
			});
		}
		return fieldList.fields;
	}

	async function fieldsExcept(except: readonly string[]) {
		return (await storedFields()).filter((field) => !except.some((left) => field === left || field.startsWith(`${left}.`)));
	}

	async function params(request: SearchRequest, offset: number): Promise<SearchParams> {
		const returned = request.returned;
		return {
			offset,
			limit: request.size,
			filter: request.filters.map(filterExpression),
			...(request.text.trim() && request.fields.length ? { attributesToSearchOn: [...request.fields] } : {}),
			...(request.sort?.length ? { sort: [...request.sort] } : {}),
			...(request.facets?.length ? { facets: [...request.facets] } : {}),
			...(returned ? { attributesToRetrieve: "only" in returned ? [...returned.only] : await fieldsExcept(returned.except) } : {}),
		};
	}

	/**
	 * The latest finished task on this index and of any index swap, or `SearchChangedError` while one runs: a deep read
	 * that sees the same before and after read an index that held still.
	 */
	async function idleRevision() {
		const revisions = await Promise.all([{ indexUids: [indexName] }, { types: ["indexSwap" as const] }].map(async (filter) => {
			const [latest, active] = await Promise.all([
				client.tasks.getTasks({ ...filter, limit: 1 }),
				client.tasks.getTasks({ ...filter, limit: 1, statuses: ["enqueued", "processing"] }),
			]);
			if (active.results.length) throw new SearchChangedError();
			return latest.results[0]?.uid ?? null;
		}));
		return JSON.stringify(revisions);
	}

	/** Pages reach only as deep as the index's `maxTotalHits`. */
	async function requireDepth(depth: number) {
		const { pagination } = await index.getSettings();
		if ((pagination?.maxTotalHits ?? 1_000) < depth) throw new SearchChangedError(true);
	}

	/** `count` keys from `offset` on, page by page. A key read twice means records moved between pages. */
	async function walkKeys(request: SearchRequest, offset: number, count: number, signal: AbortSignal) {
		const keys: string[] = [];
		const seen = new Set<string>();
		while (keys.length < count) {
			signal.throwIfAborted();
			const size = Math.min(KEYS_PER_PAGE, count - keys.length);
			const page = await index.search<{ key: unknown }>(request.text, await params({ ...request, size, returned: { only: ["key"] } }, offset + keys.length));
			keys.push(...page.hits.map(({ key }) => unseenKey(key, seen)));
			if (page.hits.length < size) break;
		}
		return keys;
	}

	async function totalOf(request: SearchRequest) {
		const counted = await index.search(request.text, {
			page: 1,
			hitsPerPage: 0,
			filter: request.filters.map(filterExpression),
			...(request.text.trim() && request.fields.length ? { attributesToSearchOn: [...request.fields] } : {}),
		});
		return counted.totalHits ?? 0;
	}

	return {
		name: "meilisearch",
		async search<T>(request: SearchRequest) {
			const offset = startOf(request, request.fromEnd ? await totalOf(request) : undefined);
			return answerOf<T>(await index.search(request.text, await params(request, offset)), offset);
		},
		async searchMany<T>(requests: readonly SearchRequest[]) {
			if (requests.length === 0) return [];
			const queries = await Promise.all(requests.map(async (request) => ({ indexUid: indexName, q: request.text, ...(await params(request, startOf(request))) })));
			const { results } = await client.multiSearch({ queries });
			return results.map((result, position) => answerOf<T>(result as SearchResponse<Record<string, unknown>>, startOf(requests[position]!)));
		},
		async read<T>(key: string, except: readonly string[]) {
			try {
				return (await index.getDocument(key, { fields: await fieldsExcept(except) })) as T;
			} catch (error) {
				if (error instanceof MeilisearchApiError && error.cause?.code === "document_not_found") return null;
				throw error;
			}
		},
		/** Read while the index holds still: a write or an index swap meanwhile throws `SearchChangedError`. */
		async keys(request: SearchRequest, offset: number, count: number, signal: AbortSignal) {
			const revision = await idleRevision();
			await requireDepth(offset + count);
			const keys = await walkKeys(request, offset, count, signal);
			const total = await totalOf(request);
			if ((await idleRevision()) !== revision) throw new SearchChangedError();
			return { keys, total };
		},
	};
}
