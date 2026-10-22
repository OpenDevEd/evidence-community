import type { OpenScholarInstitutionRequest } from "./institution-catalog-contract";

export type OpenScholarTag = { count: number; name: string };
export type OpenScholarTagPage = { items: OpenScholarTag[]; nextCursor: string | null };

/**
 * One page of the tags on the library's public records, with how many records carry each. They come from the search
 * index's tag counts, which are the counts readers see, so the whole list is filtered and paged here; the cursor is
 * the offset of the next page.
 */
export function pageTagCounts(counts: Record<string, number>, request: OpenScholarInstitutionRequest): OpenScholarTagPage {
	const query = request.query.toLocaleLowerCase();
	const sign = request.direction === "asc" ? 1 : -1;
	const rows = Object.entries(counts)
		.filter(([name]) => !query || name.toLocaleLowerCase().includes(query))
		.map(([name, count]) => ({ name, count }))
		.sort((left, right) =>
			request.sort === "name"
				? sign * left.name.localeCompare(right.name)
				: sign * (left.count - right.count) || left.name.localeCompare(right.name),
		);
	const from = Math.max(0, Number(request.cursor ?? 0) || 0);
	const items = rows.slice(from, from + request.pageSize);
	return { items, nextCursor: from + request.pageSize < rows.length ? String(from + request.pageSize) : null };
}
